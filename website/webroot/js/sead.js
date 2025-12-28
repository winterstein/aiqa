
$(function(){
	$("span.email").each(function() {
		var name = $(this).attr('name');
		var domain = $(this).attr('domain');
		var email = name+"@"+domain;
		$(this).html("<a href='mailto:"+email+"'>"+email+"</a>");
	});

	$('form#mailing-list').submit(function(e){
		var $f = $(this);
		var data = {};
		$("input,select,textarea", $f).each(function(){
			data[$(this).attr('name')] = $(this).val();
		});
		console.log("data", data);
		$.ajax({
			url: $f.attr('action'),
			data: data
		}).then(function(r) {
			console.log(r);
			// assume OK
			notify("Thank you for signing up to our mailing list.");
		}, function(err) {
			notify("There was an error: "+err, 'danger');
		});
		// optimistic response - stop repeat submits
		let $btn = $('button[type=submit]', this);
		$btn.addClass("disabled").text($btn.text()+' ...');
		e.preventDefault();
	});
	
	function notify(msg, type) {
		$('form#mailing-list').append("<div class='alert alert-"+(type||"success")+"' role='alert'>"+msg+"</div>");
	}

});


// Making the Jumbotron image darken as you scroll past it
$(function () {
    $(window).scroll(function () {
        var currentScrollTop = $(window).scrollTop();
        $('#blackOverlay').css('opacity',currentScrollTop/$('#blackOverlay').height());

    });
});