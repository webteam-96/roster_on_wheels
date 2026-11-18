$(document).ready(function(){
	var winH = $(window).height();
	var winW = $(window).width();
	var topHeader = $('.top-bar-two').height() + $('.main-nav').height();
	$('.mouse-btn-down').click(function(){
		$('html,body').animate({
			scrollTop: winH - topHeader
		});
		//alert(winH);
	});

	 
$(window).scroll(function(event){

	var st = $(this).scrollTop();

	if (winW >= 992) {

	 if (st > 200){
		   $('.top-bar').slideUp();
		   $('header').addClass('minHeader')
		   } else {
			   $('.top-bar').slideDown('fast');
			   $('header').removeClass('minHeader')
		 }
	}
  
  
});


	$('#toggleMenu').click(function () {
		//alert('b')
		$('body').stop().toggleClass('toggleNav');
		//$(this).toggleClass('');
		if ($(this).is(':checked')) {

			$(this).parent('.menu-bar').addClass('fa-times');
			$(this).parent('.menu-bar').removeClass('fa-bars');
		} else {
			$(this).parent('.menu-bar').addClass('fa-bars');
			$(this).parent('.menu-bar').removeClass('fa-times');

        } 
	});


	//$('.main-nav nav ul ul').before('<span class="fal fa-chevron-down"></span>')


});