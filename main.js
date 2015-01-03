window.setTimeout(function() {
    readability.extract(function(data){

        console.log(data);
        console.log(document.URL);

        if (data){
            $.ajax({
                type: "POST",
                url: "http://www.connectionspotter.com/api/0.0.1/connections",
                data: {
                    article: data,
                    articleUrl: document.URL
                },
                success: function(data){console.log("win");},
                error: function(data){console.log("lose");}
        });
        }

    });
}, 3000);
