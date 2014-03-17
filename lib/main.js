/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

require("sdk/preferences/service").set("javascript.options.strict", false);

// imports
var widgets = require("sdk/widget");
var data = require("sdk/self").data;
var tabs = require("sdk/tabs");
var requests = require("sdk/request");
var timers = require("sdk/timers");
// NOTE: Now that I have figured out the Firefox version issue, this try catch should not longer be needed.
try {
    var sidebars = require("sdk/ui/sidebar");
} catch (err) {
    showUnsupported();
}


var sidebarWorker = null;
var sidebarMessage = null;
var notificationWorker = null;

// define a sidebar
if (sidebars) {
    var sidebar = sidebars.Sidebar({
        id: "connection-spotter-sidebar",
        title: "ConnectionSpotter",
        url: require("sdk/self").data.url("sidebar.html"),
        onAttach: sidebarAttach,
        onDetach: sidebarDetach,
    });
}

// define a widget
var widget = widgets.Widget({

    id: "connection-spotter-widget",
    label: "Show connections!",
    contentURL: require("sdk/self").data.url("eye.ico"),
    
    onClick: function() {
    
        //Show the error message again if sidebars not supported
        if (!sidebars){
            showUnsupported();
            return;
        }
        sidebarMessage = null;
        sidebar.show();
        showProcessing();
        
        getPoligraftAnalysis(function(json) {
            getWebappAnalysis(json, function(webappJson){
                sidebarMessage = {
                    "view": buildTemplateView(webappJson),
                    "template": require("sdk/self").data.load("body.mustache"),
                };
                updateSidebar();
            });
        });
    }
});

/*
    This function should/will only be bound to the sidebar onAttach event.
    Grab the sidebar worker when it's ready and attempt to update its content.
*/
function sidebarAttach(worker){

    // listen for a "ready" message from the sidebar
    worker.port.on("ready", function() {
        // save the worker for later communication
        sidebarWorker = worker;
        // Try to update the sidebar (will only do anything if the data has been pulled from the webapp/poligraft or sidebarMessage has been set.)
        updateSidebar();
    });
}

/*
    This function should/will only be bound to the sidebar onDetach event.
    Clear the sidebarWorker variable.
*/
function sidebarDetach(){
    // Remove reference to the worker so that we do not try to communicate with a non existant thing.
    sidebarWorker = null;
}

/*
    Make a call to the webapp with the given Poligraft API data. Call <callback> when
    the webapp responds with the webapp's json response as the first argument.
*/
function getWebappAnalysis(poligraftJson, callback){
    var r = requests.Request({
        url: "http://connection-spotter.herokuapp.com/api/v1.0/connections",
        content: {data: JSON.stringify(poligraftJson)},
        onComplete: function(response){
            if (response.status == 200){
                callback(response.json);
            } else {
                showError();
            }
        }
    });
    r.post();
}

/*
    Make the calls necessary to the Poligraft API to retrieve an analysis of the
    url in the current tab. Calls <callback> when ready with the json response passed as
    the first argument.
*/
function getPoligraftAnalysis(callback, page_url){

    // if no page_url provided, use the active tab's url.
    page_url = typeof page_url !== 'undefined' ? page_url : tabs.activeTab.url;
    
    requests.Request({
        url: "http://poligraft.com/poligraft",
        content: {
            url: page_url,
            json: 1,
            suppresstext: true,
            textonly: true,
        },
        onComplete: function (response){
        
            if (response.status === 500){
                // There is a weird issue with url arguments to poligraft.
                // This url causes a 500 error: http://www.nytimes.com/2014/03/06/us/politics/senate-rejects-obama-nominee-linked-to-abu-jamal-case.html?rref=homepage&module=Ribbon&version=origin&region=Header&action=click&contentCollection=Home%20Page&pgtype=article&_r=0
                // This url is fine (%20 removed): http://www.nytimes.com/2014/03/06/us/politics/senate-rejects-obama-nominee-linked-to-abu-jamal-case.html?rref=homepage&module=Ribbon&version=origin&region=Header&action=click&contentCollection=HomePage&pgtype=article&_r=0
                
                console.log("500 error occurred with poligraft");
                
                // If you get a 500 error, try again with %20s stripped
                var twenties_removed = tabs.activeTab.url.replace("%20", "");
                if (tabs.activeTab.url != twenties_removed){
                    console.log("Stripped %20s, trying again.");
                    getPoligraftAnalysis(callback, twenties_removed);
                    return;
                }
                
            }
            if (response.json === null){
                showError();
                return;
            }
            var attemptsLeft = 10;
            // Make another call, since the response to this one is (almost definitely) 200.
            function pollAgain(attempts_left){
                if (attemptsLeft > 0) {
                    requests.Request({
                        url: "http://poligraft.com/"+response.json.slug+".json",
                        onComplete: function(response){
                            if (response.status == 200 || (response.status == 202 && (response.json.status == "Entities Linked"))){ //response.json.status == "Entities Extracted" || response.json.status == "Contributors Identified"
                                callback(response.json);
                            } else if (response.status != 202){
                                console.log("Something bad happened with poligraft!");
                            } else {
                                // Try again in 5 seconds
                                timers.setTimeout(function(){
                                    attemptsLeft -= 1
                                    pollAgain(attemptsLeft);
                                }, 5000);
                            }
                        }
                    }).get();
                } else {
                    console.log("Maximum number of poligraft attempts reached.");
                    showError();
                }
            }
            pollAgain(attemptsLeft);    
        }
    }).get();
}

/*
    Attempt to trigger an update of the sidebar's content. This will only cause the content
    to change if the sidebar is ready and if the data has successfully been pulled from
    poligraft / the webapp
*/
function updateSidebar(){
    if (sidebarWorker != null && sidebarMessage != null){
        if (sidebarMessage === "error"){
            var html = data.load("error.html");
            sidebarWorker.port.emit("showHtml", html);
        } else {
            sidebarWorker.port.emit("showConnections", sidebarMessage);
        }
    }
}

/*
    Show an error in the sidebar
*/
function showError(){
    sidebarMessage = "error";
    updateSidebar();
}
/*
    Show the processing dialoge in the sidebar.
    TODO: make this function work the same way showError does.
*/
function showProcessing(){
    if (sidebarWorker != null){
        var html = data.load("processing.html");
        sidebarWorker.port.emit("showHtml", html);
    }
}

/*
    Display an error pannel if the sidebar is unsupported.
*/
function showUnsupported(){
    var panel = require("sdk/panel").Panel({
        width: 180,
        height: 180,
        contentURL: data.url("unsupported.html")
    });
    panel.show();
}

/*
    Condenses duplicates in an assets array.
*/
function condenseAssets(assets){
    var assetHash = {};
    assets.forEach(function(asset){
        if (!(asset.entity_compare_string in assetHash)){
            assetHash[asset.entity_compare_string] = {"minvalue": asset.minvalue, "maxvalue": asset.maxvalue};
        } else {
            assetHash[asset.entity_compare_string].minvalue += asset.minvalue;
            assetHash[asset.entity_compare_string].maxvalue += asset.maxvalue;
        }
    });
    var ret = [];
    for (key in assetHash) {
        if (!assetHash.hasOwnProperty(key)) {
            continue;
        }
        ret.push({"entity_compare_string": key, "minvalue": assetHash[key].minvalue, "maxvalue": assetHash[key].maxvalue});
    }
    return ret;
}

/*
    Builds the template view object from the large JSON returned by the webapp.
*/
function buildTemplateView(webappJson){
    var view = {
        politicians : [],
    };  
    
    webappJson.entities.forEach(function(entity){
        if (("assets" in entity && entity.assets.length > 0) || ("chains" in entity && entity.chains.length > 0)){
            // Create a new politician object and add it to the list.
            var pol = {name : entity.name, crp_id : entity.crp_id};
            view.politicians.push(pol);
        }
        if ("assets" in entity && entity.assets.length > 0){
            // Create an assets array
            pol["assets"] = [];
            // Add each asset to the array
            var condensedAssets = condenseAssets(entity.assets);
            condensedAssets.forEach(function(asset){
                pol["assets"].push(asset);
            }); 
        }
        if ("chains" in entity && entity.chains.length > 0){
            pol["chains"] = [];
            // Each chain needs these things: {startName:"foo", endName:"baz", names:[{n:"foo", arrow:true}, {n:"bar", arrow:true}, {n:"baz", arrow:false}], relationships:[{ent1:"foo", ent2:"bar", text:"chairman of", link:"www.quz.com/rel1"}, ... ]}
            entity.chains.forEach(function(chain){
                pol.chains.push(getChainObject(chain));
            });            
        }
    });
    return view;
}

/*
    Return an object suitable for the mustache template.
*/
function getChainObject(chain){
    var categoryMapping = {"1":"Position", "2": "Education", "3":"Membership", "4":"Family", "5":"Donation", "6":"Transaction", "7":"Lobbying","8":"Social","9":"Professional","10":"Ownership"};
    
    // Build names array
    var names = [];
    for (var i = 0; i < chain.length; i++) {
        names.push({
            n : chain[i][0]["name"],
            arrow: true,
        });
    }
    names.push({
        n: chain[chain.length-1][2]["name"],
        arrow: false,
    });
    
    // Get startName, endName
    var startName = names[0].n;
    var endName = names[chain.length].n;
    
    // Build relationships
    var relationships = [];
    for (var i = 0; i < chain.length; i++) {
    
        // Get entity names (in proper order)
        if (chain[i][1]["entity1_id"] == chain[i][0]["id"]) {
            var firstEnt = chain[i][0];
            var secondEnt = chain[i][2];
        } else {
            var firstEnt = chain[i][2];
            var secondEnt = chain[i][0];
        }
        
        // Build relationship text
        var description = chain[i][1]["description2"];
        if (chain[i][1]["description1"] != ""){
            description = chain[i][1]["description1"];
        }
        if (description != ""){
            description = " ("+description+")";
        }
        
        var temporalString = "";
        if (chain[i][1].is_current === "1"){
            temporalString = " - current";
        } else if (chain[i][1].is_current === "0" || chain[i][1].end_date !== ""){
            temporalString = " - past";
        } else { // (chain[i][1].end_date === "" && chain[i][1].is_current === "")
            temporalString = " - past or current";
        }
        
        
        var interstitalText = categoryMapping[chain[i][1]["category_id"]] + description + temporalString;
        relationships.push({
            "ent1":firstEnt["name"],
            "ent2": secondEnt["name"],
            "text": interstitalText,
            "link": chain[i][1].uri,
        });
    }
    return {"names":names, "startName":startName, "endName":endName, "relationships":relationships};
}
