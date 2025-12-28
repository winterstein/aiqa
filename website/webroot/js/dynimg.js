/**
 * Dynamic image resizing!
 * How to use:
 * Put your image in HTML like so...
 * 
 * <img class="dyn-img" data-src="/img/rawImageFile.png" data-msrc="img/rawImageFileForMobile.png" data-width="300" />
 * 
 * `data-src` Source file for the image.   
 * `data-msrc` (optional) Mobile source file. If set, this will be used as-is on mobiles.    
 * 		Use-case: to allow for a different image to fit the different aspect-ratio of mobile.   
 * `data-width` (optional) Source width (i.e. what scaling to apply). If unset, the width is calculated dynamically from the browser layout.
 * 
 * ...and this script will catch it, encode the URL as a cache-and-scale request to MediaCacheServlet,
 * and put that URL in the <img> tag's "src" attribute.
 */


// Let's quantise image sizes into 360px intervals (ie, neatly matched to common phone screen widths) + some tiny ones for good measure.
const sizes = [ 2160, 1800, 1440, 1080, 720, 360, 180, 90 ];


/** A 1x1 transparent PNG for use as a placeholder src */
const transparentPixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=';

// Use production media
// (for dev of media) Where should we request cached/resized images? Use the media cluster which matches the current local/test/prod site.
let domainPrefix = ""; //window.location.host.match(/^(local|test)/);
// domainPrefix = domainPrefix ? domainPrefix[0] : '';
const mediaCacheBase = `${window.location.protocol}//${domainPrefix}media.good-loop.com/uploads/mediacache/`;


/** Take a (hopefully image) URL and wrap it in a request to MediaCacheServlet, with optional scaling. */
function wrapUrl(src, width) {
	// resolve relative URLs
	const url = new URL(src, document.location);

	// use e.g. data: urls uncached
	if (!url.protocol.match(/http/)) return src;

	// base64web-encode URL for use as filename
	let href = url.href; 
	// local won't work as the media server can't access it
	if (href.includes("://local")) {
		return src;
	}
	const urlEncoded = btoa(href).replace('+', '-').replace('/', '_');
	let extension = url.pathname.match(/\.[^.]+$/)[0];
	
	let sizeDir = '';
	if (width && !extension.match(/\.svg/)) {
		// Step down through quantised image widths & find smallest one bigger than estimated pixel size
		let qWidth = sizes[0];
		for (let i = 0; i < sizes.length && sizes[i] >= width; i++) {
			qWidth = sizes[i];
		}
		sizeDir = `scaled/w/${qWidth}/`;
	}
	return mediaCacheBase + sizeDir + urlEncoded + extension; // What's the from for?? The server can check for a referer + '?from=good-loop-ad-unit';
};

/** For if the page specifies a desktop/mobile split (which may be redundant??) */
const isMobile = () => {		
	// small window?
	if (window.innerWidth < 400 || window.innerHeight < 400) return true;
	// sniff the UA??
	const userAgent = navigator.userAgent || navigator.vendor || window.opera;
	let _isMobile = userAgent.match('/mobile|Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i');
	return !!_isMobile;
};

function processImg(img) {
	const rawSrc = img.getAttribute('data-src');
	// mobile? If the page specifies a mobile image, just use that
	if (isMobile() && img.getAttribute('data-msrc')) {		
		img.src = img.getAttribute('data-msrc');
		return;
	}
	// source width specified?
	if (img.getAttribute('data-width')) {		
		let width = img.getAttribute('data-width');
		img.src = wrapUrl(rawSrc, width);
		return;
	}

	// done on image load to allow for the browser to have computed sizing info
	function setSrc() {
		// no onload loop!
		img.removeEventListener('load', setSrc);

		// - Check img for an existing width rule
		// - If none, set width: 100% inline, to estimate largest occupied space
		// - Store any existing inline width rule to restore later
		let inlineWidth = '';
		const existingWidth = window.getComputedStyle(img).getPropertyValue('width');
		if (!existingWidth) {
			inlineWidth = img.style.width;
			img.style.width = '100%';
		}

		// get current pixel width
		let width = img.clientWidth;

		// restore the image's original inline width rule
		if (!existingWidth) {
			img.style.width = inlineWidth;
		}

		// Get scaled + cached image URL and set it on the <img>
		img.src = wrapUrl(rawSrc, width);
	} // ./setSrc

	img.addEventListener('load', setSrc);

	// Set img src to instant-loading placeholder data-URL to probe size without loading anything
	img.src = transparentPixel;
}


function loadDynamicImages() {
	/** Find all marked, unprocessed <img> tags and process them */
	const dynimgs = document.querySelectorAll('img.dyn-img:not(.processed)');
	Array.from(dynimgs).forEach(dynimg => {
		processImg(dynimg);
		// Mark the <img> as processed
		dynimg.classList.add('processed');
	});
};

// Watch the document for new nodes (eg lazy-loaded) which might contain noscript.dyn-img tags
const dynImgObserver = new MutationObserver(loadDynamicImages);
dynImgObserver.observe(document.body, { subtree: true, childList: true });

window.addEventListener('load', loadDynamicImages);
