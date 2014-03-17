/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//console.log("sidebar.js checking in!");

addon.port.emit("ready");
addon.port.on("showConnections", updateSidebarContent);
addon.port.on("showHtml", showHtml);

function updateSidebarContent(message){
    var output = Mustache.render(message.template, message.view);
    document.getElementById("my-content").innerHTML = output;
    $('[data-toggle="tooltip"]').tooltip();
}

function showHtml(html){
    document.getElementById("my-content").innerHTML = html;
}