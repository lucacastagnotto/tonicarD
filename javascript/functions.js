/* fetch to backend */
const backend = "http://127.0.0.1:8080"

function readJSON(path){
	return new Promise((resolve, reject) => {
		fetch(path)
			.then(response => response.json())
			.then(data => resolve(data))
			.catch(error => {
				reject("Non esiste il file JSON in: " + path);
			});
	});
}

function addNewImage(formData){
	return new Promise((resolve, reject) => {
		fetch(backend + "/addNewImage", {
			method: "POST",
			body: formData
		})
		.then(response => response.json())
		.then(data => resolve(data))
		.catch(error => {
			reject("Errore nel salvataggio della nuova immagine");
		});
	});
}

function generateJSON() {
	return new Promise((resolve, reject) => {
		fetch(backend + "/generateCardsInfo", {
			method: "GET",
		})
		.then(response => response.json())
		.then(data => resolve(data))
		.catch(error => {
			reject("Errore nella creazione del file cadsInfo.json");
		});
	});
}

function deleteCards_inFile(cardsToDelete) {
	return new Promise((resolve, reject) => {
		fetch(backend + "/deleteNsaveJSON", {
			method: "POST",
			body: JSON.stringify(cardsToDelete)
		})
		.then(response => response.json())
		.then(data => resolve(data))
		.catch(error => reject("Cancellazione schede: connessione con il server fallito."))
	});
}

function updateCards_inFile(cardsToUpdate) {
	return new Promise((resolve, reject) => {
		fetch(backend + "/updateNsaveJSON", {
			method: "POST",
			body: JSON.stringify(cardsToUpdate)
		})
		.then(response => response.json())
		.then(data => resolve(data))
		.catch(error => reject("Aggiornamento schede: connessione con il server fallito."))
	});
}

function imageExists(src) {
	return new Promise((resolve, reject) => {
		fetch(src)
			.then(response => {
				if (response.ok) resolve(true);
				else resolve(false);
			})
			.catch(error => {
				reject("Errore nel controllo delle immagini");
			});
	});
}

function synchroImagesJSON() {
	return new Promise((resolve, reject) => {
		fetch(backend + "/includeImages_inJSON")
			.then(response => resolve())
			.catch(error => {
				reject("Errore nel controllo delle immagini");
			});
	});
}

function sendImgToGC(card, signal) {
	return new Promise((resolve, reject) => {
		fetch('http://127.0.0.1:8080/autoAnnotation', {
			method: 'POST',
			body: card,
			signal: signal
		})
		.then(response => {
			if (response.ok) {
				return response.json()
			}
			reject(new Error("Invio fallito. Errore di rete " + response.status));
		})
		.then(data => {
			resolve(data);
		})
		.catch(error => {
			if (error.name == 'AbortError') {
				reject("Invio scheda annullato");
				return;
			}
			reject("Invio fallito. Riprova");
		})
	})
}

function saveHandAnnotation(annotations) {
	return new Promise((resolve, reject) => {
		fetch('http://127.0.0.1:8080/handAnnotation', {
			method: 'POST',
			body: JSON.stringify(annotations)
		})
		.then(response => response.json())
		.then(data => resolve(data))
		.catch(error => reject("Salvataggio annotazioni fallito."))
	});
}

/* Async functions */
async function appendCards(mediaScroller, listVars) {
	var cardsToDelete = [];
	for (var i = 0; i < listVars["list"].length; i++) {
		const card = listVars["list"][i];
		let imgSrc = "server/resizedImages/" + card["filename"];
		let image = await imageExists(imgSrc);
		if (!image) {
			cardsToDelete.push(card["filename"]);
			continue;
		}
		let newElement = document.createElement("div");
		newElement.classList.add("media-element", "collapse");
		if (i < listVars["index"]) {
			newElement.classList.add("show");
		}
		newElement.setAttribute("data-id", card["id"]);
		newElement.setAttribute("data-cat", mapStatusCat(card["status"]));
		let newImg = document.createElement("img");
		newImg.setAttribute("src", imgSrc);
		newImg.setAttribute("loading", "lazy");
		let newFigcaption = document.createElement("figcaption");
		newFigcaption.classList.add("text-center", "pe-1");
		newFigcaption.textContent = card["id"];
		// FUTURE UPDATE: createElement info-box for images already annotated
		newElement.append(newImg);
		newElement.append(newFigcaption);
		if(listVars["name"] == "noAnn") {
			let svgCheck = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svgCheck.classList.add("check", "collapse");
			let use = document.createElementNS("http://www.w3.org/2000/svg", "use");
			use.setAttribute("href", "#check");
			svgCheck.append(use);
			let onloadText = document.createElement("p");
			onloadText.classList.add("text-onload", "collapse");
			onloadText.textContent = "Annotazione in corso...";
			newElement.append(svgCheck);
			newElement.append(onloadText);
		}
		if (listVars["name"] == "recents") {
			let span = document.createElement("span");
			span.classList.add("float-end", "status");
			span.setAttribute("tabindex", "0");
			span.setAttribute("data-bs-toggle", "tooltip");
			span.setAttribute("data-bs-custom-class", "custom-tooltip");
			span.textContent = "S:" + card["status"];
			newFigcaption.append(span);
		}
		mediaScroller.append(newElement);
	}
	// create button.load-more
	let loadMore_btn = document.createElement("button");
	loadMore_btn.classList.add("load-more", "collapse");
	loadMore_btn.textContent = "Carica altro";
	mediaScroller.append(loadMore_btn);
	if (listVars["index"] < listVars["list"].length) {
		loadMore_btn.classList.add("show");
	}
	if(cardsToDelete.length < 1) {
		return;
	}
	// from JSON-file remove the cards whose image is not in filesystem anymore
	for (const el of cardsToDelete) {
		let idx = listVars["list"].findIndex(c => c["filename"] == el);
		if (idx > -1) {
			listVars["list"].splice(idx, 1)
		}
	}
	try {
		await deleteCards_inFile(cardsToDelete);
	}
	catch(error) {
		console.error(error);
	}
}

async function initSlider() {
	if (sessionStorage.getItem("cards")) {
		cards = JSON.parse(sessionStorage.getItem("cards"));
	}
	else {
		try {
			cards = await readJSON("/server/cardsInfo.json");
		}
		catch(error) {
			console.error(error);
			try {
				let promise = await generateJSON();
				cards = await readJSON("/server/cardsInfo.json");
			}
			catch (error) {
				console.error(error);
			}
		}
		finally {
			sessionStorage.setItem("cards", JSON.stringify(cards));
		}
	}
	for (const card of cards) {
		switch (card["status"]) {
			case 0:
				noAnn.list.push(card);
				break;
			case 1:
				autoAnn.list.push(card);
				break;
			case 2:
				handAnn.list.push(card);
				break;
		}
	}
	// append cards on sliders
	setMediaScroller(noAnn);
	setMediaScroller(autoAnn);
	setMediaScroller(handAnn);
	// get recents
	if (sessionStorage.getItem("recents")) {
		let recentsCards = JSON.parse(sessionStorage.getItem("recents"));
		for (const card of recentsCards) {
			recents["list"].push(card);
		}
	}
	setMediaScroller(recents);
}

function updateSliders(cardId, status, oldSlider, newSlider) {
	if (oldSlider == newSlider) {
		return;
	}
	const oldSlider_container = document.getElementById(oldSlider);
	const newSlider_container = document.getElementById(newSlider);
	var cardIndex = cards.findIndex(c => c["id"] == cardId);
	if(cardIndex < 0) {
		// should not be here
		return;
	}
	var card = cards[cardIndex];
	
	// move .media-element from old to new .media-scroller
	var mediaElement = oldSlider_container.querySelector(".media-element[data-id='" + cardId + "']");
	if (oldSlider == "noAnn") {
		mediaElement.classList.remove("onload");
		mediaElement.querySelector("svg").remove();
		mediaElement.querySelector("p").remove();
	}
	newSlider_container.querySelector(".media-scroller").appendChild(mediaElement);
	mediaElement.setAttribute("data-cat", newSlider);
	
	// update old list and old .media-scroller style
	let oldList = getList[oldSlider]()["list"];
	let idx = oldList.findIndex(c => c["id"] == card["id"]);
	if (idx < 0) {
		// should not be here
		return;
	}
	oldList.splice(idx, 1);
	toggleSliderArrows(oldSlider_container.querySelector(".media-scroller"));
	if(oldList.length < 1) {
		oldSlider_container.classList.remove("show");
	}
	
	// update new list and new .media-scroller style
	let newList = getList[newSlider]()["list"];
	newList.push(card);
	toggleSliderArrows(newSlider_container.querySelector(".media-scroller"));
	newSlider_container.classList.add("show");
	return;
}

async function handleMultipleAPIReq() {
	// update slider
	var selectedCards = document.querySelectorAll(".selected");
	for (const card of selectedCards) {
		card.classList.remove("selected");
		card.querySelector("svg.check").classList.remove("show");
		card.classList.add("onload");
		card.querySelector(".text-onload").classList.add("show");
		// update card in searchPage
		let searchCard = search.querySelector(".media-element[data-id='" + card.getAttribute("data-id") + "']");
		searchCard.classList.add("onload");
		searchCard.querySelector(".text-onload").classList.add("show");
	}
	googleAnn_btn.textContent = "Richiedi annotazione di 0 schede";
	googleAnn_btn.disabled = true;
	cancelSelection_btn.classList.remove("show");
	
	for (const el of noAnn_selected) {
		// update notify box
		let newItem = document.createElement("div");
		newItem.classList.add("notify-item", "sending");
		let newSpinner = document.createElement("div");
		newSpinner.classList.add("spinner-border", "spinner-border-sm", "text-primary");
		newSpinner.setAttribute("role", "status");
		let newId = document.createElement("div");
		newId.classList.add("cardId", "fw-semibold");
		newId.setAttribute("data-id", el);
		newId.textContent = el;
		let newStatus = document.createElement("div");
		newStatus.classList.add("status");
		newStatus.textContent = "Annotazione in corso...";
		let newSVG = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		newSVG.classList.add("ms-auto", "close");
		let newUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
		newUse.setAttribute("href", "#x-circle");
		newSVG.append(newUse);
		newItem.append(newSpinner);
		newItem.append(newId);
		newItem.append(newStatus);
		newItem.append(newSVG);
		notifyList.append(newItem);
		// update arrays
		sendingCards.push(el);
	}
	noAnn_selected = [];
	notifyBox.querySelector(".empty").classList.remove("show");
	badge.classList.add("show");

	// send to GC
	while(sendingCards.length > 0) {
		// wait until higher priority card has been sent
		while (card_withPriority) {
			googleChannel_free = true;
			await new Promise(r => setTimeout(r, 4000));
		}
		googleChannel_free = false;
		controller = new AbortController();
		signal = controller.signal;
		var cardId = sendingCards[0];
		var item = notifyList.querySelector(".cardId[data-id='" + cardId + "']").closest(".notify-item");
		try {
			await sendImgToGC(cardId, signal);
			// notifyBox
			item.classList.remove("sending");
			item.querySelector(".spinner-border").remove();
			item.querySelector(".status").textContent = "Annotazione autom. fatta";
			item.querySelector("svg").remove();
			let newSVG = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			newSVG.classList.add("ok");
			let newUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
			newUse.setAttribute("href", "#check");
			newSVG.append(newUse);
			let newTime = document.createElement("div");
			newTime.classList.add("time", "ms-auto");
			const d = new Date();
			newTime.textContent = d.toTimeString().substr(0,5)
			item.append(newTime);
			item.insertBefore(newSVG, item.firstChild);
			// update cardsInfo.json & cards[]
			let card = cards.find(c => c["id"] == cardId);
			if (!card) {
				card = {
					"filename": cardId + "jpg",
					"id": cardId,
					"status": 1
				};
				cards.push(card);
			}
			else {
				card["status"] = 1;
			}
			sessionStorage.setItem("cards", JSON.stringify(cards));
			try {
				await updateCards_inFile([card]);
			}
			catch(error) {
				console.error(error);
			}
			
			// .media-scroller
			updateSliders(cardId, 1, "noAnn", "autoAnn");
			updateRecents(cardId);
			// in searchPage
			let searchCard = search.querySelector(".media-element[data-id='" + cardId + "']");
			searchCard.classList.remove("onload");
			searchCard.querySelector(".text-onload").classList.remove("show");

		} catch (error) {
			console.error(error);
			if (error != "Invio scheda annullato") {
				// notifyBox
				item.classList.remove("sending");
				item.querySelector(".spinner-border").remove();
				item.querySelector(".status").textContent = "Annotazione autom. fallita";
				item.querySelector("svg").remove();
				let newSVG = document.createElementNS("http://www.w3.org/2000/svg", "svg");
				newSVG.classList.add("failed");
				let newUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
				newUse.setAttribute("href", "x-circle");
				newSVG.append(newUse);
				item.insertBefore(newSVG, item.firstChild);
				// update slider
				let card = container_NoAnn.querySelector(".media-element[data-id='" + cardId + "']");
				card.classList.remove("onload");
				card.querySelector(".text-onload").classList.remove("show");
				// update card in searchPage
				let searchCard = search.querySelector(".media-element[data-id='" + cardId + "']");
				searchCard.classList.remove("onload");
				searchCard.querySelector(".text-onload").classList.remove("show");
			}
		}
		badge.classList.add("show");
		sendingCards.splice(0, 1);
	}
}


/* Other */

function setMediaScroller(listVars) {
	listVars.index = Math.min(imagesXtime, listVars.list.length);
	let slider = document.getElementById(listVars.name);
	if(listVars.list.length > 0) {
		slider.classList.add("show");
		let mediaScroller = slider.querySelector(".media-scroller");
		appendCards(mediaScroller, listVars);
	}
	else {
		slider.classList.remove("show");
	}
}

function showCards(mediaScroller, startIndex, endIndex, list) {
	for (var i = startIndex; i < endIndex; i++) {
		let j = i + 1;
		let mediaElement = mediaScroller.querySelector(".media-element:nth-child(" + j + ")");
		mediaElement.classList.add("show");
	}
	if(list.index >= list.list.length) {
		mediaScroller.querySelector(".load-more").classList.remove("show");
	}
}

function hideCards(mediaScroller, startIndex, endIndex, list) {
	for (var i = startIndex; i < endIndex; i++) {
		let j = i + 1;
		let mediaElement = mediaScroller.querySelector(":nth-child(" + j + ")");
		mediaElement.classList.remove("show");
	}
	if(list.index < list.list.length) {
		mediaScroller.querySelector(".load-more").classList.add("show");
	}
}

function handleNotAnnotated(mediaElement) {
	if (mediaElement.classList.contains("onload")) {
		return;
	}
	if(mediaElement.classList.contains("selected")) {
		// update style
		mediaElement.classList.remove("selected");
		mediaElement.querySelector("svg.check").classList.remove("show");
		// update array selected
		let idx = noAnn_selected.findIndex(x => x == mediaElement.getAttribute("data-id"));
		if(idx < 0) {
			return;
		}
		noAnn_selected.splice(idx, 1);
		// update button
		googleAnn_btn.textContent = "Richiedi annotazione di " + noAnn_selected.length + " schede";
		if(noAnn_selected.length < 1) {
			googleAnn_btn.disabled = true;
			cancelSelection_btn.classList.remove("show");
		}
	}
	else {
		// update style
		mediaElement.classList.add("selected");
		mediaElement.querySelector("svg.check").classList.add("show");
		// update array selected
		noAnn_selected.push(mediaElement.getAttribute("data-id"));
		// update button
		googleAnn_btn.textContent = "Richiedi annotazione di " + noAnn_selected.length + " schede";
		googleAnn_btn.disabled = false;
		cancelSelection_btn.classList.add("show");
	}
	return;
}

function handleCardClick_inSearchNRecents(mediaElement) {
	if (mediaElement.classList.contains("onload")) {
		return;
	}
	editingCard = mediaElement.getAttribute("data-id");
	// update recents
	updateRecents(editingCard);
	// go to Edit
	window.history.pushState({ page: "edit"}, "", "/edit");
	showEditPage(editingCard);
}

function findCards_inCategory(inputVal, listName) {
	inputVal = inputVal.toLowerCase();
	var list = getList[listName]().list;
	var cardsList = list.filter(card => {
		return (card["id"].toLowerCase().includes(inputVal) || (card["title"] && card["title"].toLowerCase().includes(inputVal)) || (card["author"] && card["author"].toLowerCase().includes(inputVal)))
	});
	return cardsList;
}

function toggleSliderArrows(mediaScroller) {
	if(mediaScroller.scrollWidth > mediaScroller.clientWidth) {
		mediaScroller.previousElementSibling.classList.add("show");
		mediaScroller.nextElementSibling.classList.add("show");
		mediaScroller.classList.remove("center");
	}
	else {
		mediaScroller.classList.add("center");
		mediaScroller.previousElementSibling.classList.remove("show");
		mediaScroller.nextElementSibling.classList.remove("show");
	}
}

function mapStatusCat(status) {
	switch(status) {
		case 0:
			return "noAnn";
		case 1:
			return "autoAnn";
		case 2:
			return "handAnn";
	}
}

/* Edit */
function showError(errorMsg) {
	editErr_msg.textContent = errorMsg;
	editErr_msg.style.visibility = "visible";
	editErr_msg.classList.add("fade-out");
}

function hideError() {
	editErr_msg.classList.remove("fade-out");
	editErr_msg.style.visibility = "hidden";
	editErr_msg.textContent = ".";
}

function deleteBox() {
	if (card_withPriority) {
		return;
	}
	const idx = quads.findIndex((q) => q.id == lastQuadSelected);
	if(idx < 0) {
		showError(errMessages["deletion"]);
		return;
	}
	const quad = quads[idx];
	missingLabels.push(quad.label);
	const textarea = document.getElementById(getIdFromLabel(quad.label));
	var text = textarea.value;
	textarea.value = "";
	// hide <textarea>
	const textareaHider = textarea.closest("div.ta-hider");
	textareaHider.classList.remove("show");
	// hide <select>
	const selectHider = textareaHider.parentElement.previousElementSibling.querySelector("div.sel-hider");
	//const option = selectHider.querySelector("option[value=" + getIdFromLabel(quad.label) + "]");
	selectHider.classList.remove("show");
	// update quads and control vars
	quads.splice(idx, 1);
	if (quads.length < 1 && !sendingCards.includes(editingCard)) {
		startEditing.classList.add("show");
	}
	lastQuadSelected = -1;
	toggleSelectedArea();
	updateStack({
		action: "deletion",
		id: quad.id,
		corners: quad.corners,
		startingCorners: quad.corners,
		label: quad.label,
		startingLabel: quad.label,
		color: quad.color,
		text: text
	});
	draw();
}

function resizeBox(bigger){
	if (card_withPriority) {
		return;
	}
	const idx = quads.findIndex((q) => q.id == lastQuadSelected);
	if(idx < 0) {
		showError(errMessages["resize"]);
		return;
	}
	var new_corners = [];
	const quad = quads[idx];
	var corners = quad.corners;
	for(var i = 0; i < corners.length; i++) {
		var prev = (i - 1 + corners.length) % corners.length;
		var next = (i + 1) % corners.length;
		var new_corner = quad.resizeCorner(corners[prev], corners[i], corners[next], bigger);
		new_corners.push(new_corner);
	}
	quad.updateCorners = new_corners;
	updateStack({
		action: "resize",
		id: quad.id,
		corners: new_corners,
		startingCorners: corners,
		label: quad.label,
		startingLabel: quad.label,
		color: quad.color
	});
	draw();
}

function recenter() {
	if (card_withPriority) {
		return;
	}
	scale = 1;
	translatePos.x =  0;
	translatePos.y = 0;
	draw();
}

function drawToggle() {
	if (card_withPriority) {
		return;
	}
	if(drawSelected) {
		drawSelected = false;
		const icon = pencil.closest(".svg-wrap");
		icon.classList.remove("active");
	}
	else {
		if (missingLabels.length <= 0) {
			// can't create new quads if they are already 4
			//lastQuadSelected = -1;
			showError(errMessages["draw"]);
			return;
		}
		drawSelected = true;
		const icon = pencil.closest(".svg-wrap");
		icon.classList.add("active");
	}
}

function undo() {
	if (card_withPriority) {
		return;
	}
	if(stackIndex < 0) {
		return;
	}
	var lastAction = actionsStack[stackIndex];
	var actions = {
		"generation": function(lastAction) {
			const idx = quads.findIndex((q) => q.id == lastAction.id);
			missingLabels.push(quads[idx].label);
			quads.splice(idx, 1);
			if (quads.length < 1 && !sendingCards.includes(editingCard)) {
				startEditing.classList.add("show");
			}
			// textarea
			// hide <textarea>
			const textarea = document.getElementById(labelLabelMap(lastAction.label));
			const textareaHider = textarea.closest("div.ta-hider");
			textareaHider.classList.remove("show");
			// hide <select>
			const selectHider = textareaHider.parentElement.previousElementSibling.querySelector("div.sel-hider");
			//const option = selectHider.querySelector("option[value=" + getIdFromLabel(quad.label) + "]");
			selectHider.classList.remove("show");
			if(lastQuadSelected == lastAction.id) {
				lastQuadSelected = -1;
				toggleSelectedArea();
			}
			return true;
		},
		"deletion": function(lastAction) {
			let regeneratedQuad = new Quad(lastAction.id, lastAction.corners, lastAction.color, lastAction.label, lastAction.text);
			let idx = missingLabels.indexOf(lastAction.label);
			if(idx > -1) {
				missingLabels.splice(idx, 1);
			}
			quads.push(regeneratedQuad);
			startEditing.classList.remove("show");
			// textarea
			loadText(lastAction.label, lastAction.text);
			return true;
		},
		"resize": function(lastAction) {
			let quad = quads.find((q) => q.id == lastAction.id);
			quad.updateCorners = lastAction.startingCorners;
			return true;
		},
		"movement": function(lastAction) {
			let quad = quads.find((q) => q.id == lastAction.id);
			quad.updateCorners = lastAction.startingCorners;
			return true;
		},
		"labelling": function(lastAction) {
			let quad = quads.find((q) => q.id == lastAction.id[0]);
			quad.label = lastAction.startingLabel[0];
			quad.color = labelColorMap(quad.label);
			if(lastAction.id.length > 1) {
				let quadSwap = quads.find((q) => q.id == lastAction.id[1]);
				quadSwap.label = lastAction.startingLabel[1];
				quadSwap.color = labelColorMap(quadSwap.label);
			}
			else {
				let idx = missingLabels.indexOf(lastAction.startingLabel[0]);
				if(idx > -1) {
					missingLabels.splice(idx, 1);
				}
				missingLabels.push(lastAction.label[0]);
			}
			// update textarea
			var t1 = document.getElementById(lastAction.label[0]); // textarea whose select has changed
			var t2 = document.getElementById(lastAction.startingLabel[0]); // textarea that has to swap with the changing element
			t1.closest(".box-rows").querySelector(".form-select").value = lastAction.startingLabel[0]; // update select of t1
			t2.closest(".box-rows").querySelector(".form-select").value = lastAction.label[0]; // update select of t2
			swapTextarea(t1, t2);
			return true;
		}
	};

	if(actions[lastAction.action](lastAction)) {
		stackIndex -= 1;
	}
	draw();
	return;
}

function redo() {
	if (card_withPriority) {
		return;
	}
	if(stackIndex >= actionsStack.length - 1) {
		return;
	}
	var nextAction = actionsStack[stackIndex + 1];
	var actions = {
		"generation": function(nextAction) {
			let regeneratedQuad = new Quad(nextAction.id, nextAction.corners, nextAction.color, nextAction.label);
			let idx = missingLabels.indexOf(nextAction.label);
			if(idx > -1) {
				missingLabels.splice(idx, 1);
			}
			quads.push(regeneratedQuad);
			startEditing.classList.remove("show");
			// textarea
			loadText(nextAction.label, "");
			return true;
		},
		"deletion": function(nextAction) {
			const idx = quads.findIndex((q) => q.id == nextAction.id);
			missingLabels.push(quads[idx].label);
			quads.splice(idx, 1);
			if (quads.length < 1 && !sendingCards.includes(editingCard)) {
				startEditing.classList.add("show");
			}
			//textarea
			// hide <textarea>
			const textarea = document.getElementById(labelLabelMap(nextAction.label));
			const textareaHider = textarea.closest("div.ta-hider");
			textareaHider.classList.remove("show");
			// hide <select>
			const selectHider = textareaHider.parentElement.previousElementSibling.querySelector("div.sel-hider");
			//const option = selectHider.querySelector("option[value=" + getIdFromLabel(quad.label) + "]");
			selectHider.classList.remove("show");
			if(lastQuadSelected == nextAction.id) {
				lastQuadSelected = -1;
				toggleSelectedArea();
			}
			return true;
		},
		"resize": function(nextAction) {
			let quad = quads.find((q) => q.id == nextAction.id);
			quad.updateCorners = nextAction.corners;
			return true;
		},
		"movement": function(nextAction) {
			let quad = quads.find((q) => q.id == nextAction.id);
			quad.updateCorners = nextAction.corners;
			return true;
		},
		"labelling": function(nextAction) {
			let quad = quads.find((q) => q.id == nextAction.id[0]);
			quad.label = nextAction.label[0];
			quad.color = labelColorMap(quad.label);
			if(nextAction.id.length > 1) {
				let quadSwap = quads.find((q) => q.id == nextAction.id[1]);
				quadSwap.label = nextAction.label[1];
				quadSwap.color = labelColorMap(quadSwap.label);
			}
			else {
				let idx = missingLabels.indexOf(nextAction.startingLabel[0]);
				if(idx > -1) {
					missingLabels.splice(idx, 1);
				}
				missingLabels.push(nextAction.label[0]);
			}
			// update textarea
			var t1 = document.getElementById(nextAction.label[0]); // textarea whose select has changed
			var t2 = document.getElementById(nextAction.startingLabel[0]); // textarea that has to swap with the changing element
			t1.closest(".box-rows").querySelector(".form-select").value = nextAction.startingLabel[0]; // update select of t1
			t2.closest(".box-rows").querySelector(".form-select").value = nextAction.label[0]; // update select of t2
			swapTextarea(t1, t2);
			return true;
		}
	};
	if(actions[nextAction.action](nextAction)) {
		stackIndex += 1;
	}
	draw();
	return;
}

function zoomIn() {
	if (card_withPriority) {
		return;
	}
	if(scale / scaleMultiplier > 7) {
		return;
	}
	scale /= scaleMultiplier;
	draw();
}

function zoomOut() {
	if (card_withPriority) {
		return;
	}
	if(scale * scaleMultiplier < 0.50) {
		return;
	}
	scale *= scaleMultiplier;
	draw();
}

function updateStack(action) {
	// remove actions after stackIndex
	var i = actionsStack.length - 1;
	while(i > stackIndex) {
		actionsStack.pop();
		i -= 1;
	}
	// push new action
	actionsStack.push(action);
	// update stackIndex
	stackIndex += 1;
	return;
}

function swapTextarea(t1, t2) {
	tmp_textarea = t1.cloneNode();
	tmp_text = t1.value;
	let t1Parent = t1.parentElement;
	let t2Parent = t2.parentElement;
	t1.remove();
	t1Parent.append(t2);
	t2Parent.append(tmp_textarea);
	tmp_textarea.value = t2.value;
	t2.value = tmp_text;
	return;
}

function offsetConverter(offset, tpos) {
	var f1 = (offset * devicePixelRatio - tpos) * (1/scale);
	//var f2 = offset * devicePixelRatio * 1/scale - tpos;
	return f1;
}

function setInitialState() {
	if (card_withPriority) {
		return;
	}
	nextId = 0;
	scale = 1;
	translatePos.x = 0;
	translatePos.y = 0;
	quads = [];
	actionsStack = [];
	stackIndex = -1;
	missingLabels = ["Titolo", "Autore", "Note", "Collocazione"];
	// reset quads
	for (const quad of initialState.quads) {
		let initialQuad = new Quad(++nextId, quad.corners, quad.color, quad.label);
		quads.push(initialQuad);
		startEditing.classList.remove("show");
		let idx = missingLabels.indexOf(quad.label);
		if(idx > -1) {
			missingLabels.splice(idx, 1);
		}
	}
	// reset textarea
	for (const row of initialState.boxRows) {
		var textarea = document.getElementById(row.option);
		textarea.value = row.text;
		if(row.show) {
			// add show to textarea
			var textareaHider = textarea.closest(".ta-hider");
			textareaHider.classList.add("show");
			// add show to select
			const selectHider = textareaHider.parentElement.previousElementSibling.querySelector(".sel-hider");
			const option = selectHider.querySelector("option[value=" + row.option + "]");
			option.selected = true;
			selectHider.classList.add("show");
		}
		else {
			// collapse textarea
			var textareaHider = textarea.closest(".ta-hider");
			textareaHider.classList.remove("show");
			// collapse select
			const selectHider = textareaHider.parentElement.previousElementSibling.querySelector(".sel-hider");
			selectHider.classList.remove("show");
		}
	}
	lastQuadSelected = -1;
	toggleSelectedArea();
	draw();
}

function colorConverter(color) {
  var colors = {
	"green": [0, 128, 0],
	"blue": [0, 0, 255],
	"red": [255, 0, 0],
	"black": [0, 0, 0]
  }
  return colors[color];
}

function toggleSelectedArea() {
	Array.from(box_Rows).forEach(el => {
		el.style.backgroundColor = "initial";
	});
	if(lastQuadSelected >= 0) {
		let quad = quads.find(q => q.id == lastQuadSelected);
		let label = labelLabelMap(quad.label);
		let div = document.querySelector("option:checked[value=" + label + "]").closest(".box-rows");
		let rgb = colorConverter(quad.color);
		div.style.backgroundColor = "rgba(" + String(rgb[0]) + ", " + String(rgb[1]) + ", " + String(rgb[2]) + ", 0.2)";
	}
}

function draw() {
	const ratio = annotatedImage.width / annotatedImage.height;
	ctx.clearRect(0, 0, editor.width, editor.height);
	ctx.save();
	ctx.translate(translatePos.x, translatePos.y);
	ctx.scale(scale, scale);
	ctx.drawImage(annotatedImage, 0, 0, editor.width, editor.width / ratio);
	for (const quad of quads) {
		quad.draw(ctx, lastQuadSelected);
	}
	ctx.restore();
}

function loadText(label, text){
	const textarea = document.getElementById(getIdFromLabel(label));
	textarea.value = text;
	// show <textarea>
	const textareaHider = textarea.closest("div.ta-hider");
	textareaHider.classList.add("show");
	// show <select>
	const selectHider = textareaHider.parentElement.previousElementSibling.querySelector("div.sel-hider");
	const option = selectHider.querySelector("option[value=" + getIdFromLabel(label) + "]");
	option.selected = true;
	selectHider.classList.add("show");
}

function getIdFromLabel(label){
	switch(label) {
		case "Autore":
			return "author";
		case "Titolo":
			return "title";
		case "Note":
			return "note";
		case "Collocazione":
			return "collocation";
	}
}

function labelColorMap(label) {
	switch(label) {
		case "Autore":
		case "author":
			return "blue";
		case "Titolo":
		case "title":
			return "red";
		case "Note":
		case "note":
			return "black";
		case "Collocazione":
		case "collocation":
			return "green";
	}
}

function colorLabelMap(color) {
	switch(color) {
		case "blue":
			return "Autore";
		case "red":
			return "Titolo";
		case "black":
			return "Note";
		case "green":
			return "Collocazione";
	}
}

function labelLabelMap(label) {
	switch(label) {
		case "Autore":
			return "author"
		case "author":
			return "Autore"
		case "Titolo":
			return "title"
		case "title":
			return "Titolo"
		case "Note":
			return "note"
		case "note":
			return "Note"
		case "Collocazione":
			return "collocation"
		case "collocation":
			return "Collocazione"

	}
}

/* async from EDIT */

async function saveData() {
	// prevent multiple trigger
	if (saving) {
		return;
	}
	else {
		saving = true;
	}
	var emptyTA = [];
	var textareas = document.querySelectorAll(".ta-hider.show");
	var text = "";
	// prevent 0 annotations
	if (Array.from(textareas).length == 0) {
		text = "<p>Non puoi salvare 0 annotazioni.<br>Torna in Home o crea nuove annotazioni</p>";
		let color = colorErrorToast;
		showToast(text, color);
		saving = false;
		return;
	}
	// prevent empty text
	textareas.forEach(el => {
		let textarea = el.querySelector("textarea");
		if(textarea.value.trim().length == 0) {
			emptyTA.push(labelLabelMap(textarea.id));
		}
	});
	if (emptyTA.length > 0) {
		if (emptyTA.length > 1) {
			text = "Aree di testo vuote (riempi o cancella)";
		}
		else {
			text = "Area di testo vuota (riempi o cancella)";
		}
		text = "<p>" + text + ":</p><ul>"		
		for (var i = 0; i < emptyTA.length; i++) {
			text += "<li><b>" + emptyTA[i] + "</b></li>"
		}
		text += "</ul>";
		let color = colorErrorToast;
		showToast(text, color);
		saving = false;
		return;
	};
	// add animation
	let spinner = document.createElement("span");
	spinner.classList.add("spinner-border", "spinner-border-sm", "me-3");
	spinner.setAttribute("role", "status");
	btnSave.insertBefore(spinner, btnSave.firstChild);
	btnSave.disabled = true;
	// set data to send
	var data = {
		name_file: editingCard,
		boxes: []
	}
	for (const quad of quads) {
		var label = colorLabelMap(quad.color)
		const teaxtarea = document.getElementById(labelLabelMap(label));
		var text = teaxtarea.value;
		var new_c = [];
		var cs = quad.corners;
		for (const c of cs) {
			new_c.push([c.x * originalImWidth / editor.width, c.y * originalImHeight / editor.height])
		}
		new_obj = {
			vects: new_c,
			label: label,
			text: text
		}
		data["boxes"].push(new_obj);
	}
	// send
	try {
		await saveHandAnnotation(data);
	}
	catch (error) {
		console.error(error);
		removeSpinner(btnSave);		
		return;
	}
	// after successfull try
	// update cardsInfo.json & cards[]
	removeSpinner(btnSave);
	var old_status;
	var cardIndex = cards.findIndex(c => c["id"] == editingCard);
	if(cardIndex < 0) {
		// here only when you uploaded a new image (not taken from media-scroller)
		cards.push({
			"filename": editingCard + ".jpg",
			"id": editingCard
		});
		cardIndex = cards.length - 1;
		old_status = 0;
	}
	else {
		old_status = cards[cardIndex]["status"];
	}
	let card = cards[cardIndex];
	card["status"] = 2;
	card["author"] = document.getElementById("author").value;
	card["title"] = document.getElementById("title").value;
	card["collocation"] = document.getElementById("collocation").value;
	card["notes"] = document.getElementById("note").value;
	sessionStorage.setItem("cards", JSON.stringify(cards));
	try {
		await updateCards_inFile([card]);
	}
	catch (error) {
		console.error(error);
		return;
	}
	// update mediaScroller
	updateSliders(card["id"], 2, mapStatusCat(old_status), "handAnn");
	// update recents
	updateRecents(card["id"]);
	// go to Home
	saving = false;
	showToast("<p>Hai annotato con successo la scheda <b>" + editingCard + "</b>", colorSuccessToast);
	window.history.pushState({ page: "home"}, "", "/home");
	showHomePage();
}

function gotoHome() {
	window.history.pushState({ page: "home"}, "", "/home");
	showHomePage()
}

function showEditPage(card) {
	divTitle.textContent = card;
	annotatedImage.src = "./server/all_caronti_cards/" + card + ".jpg";
	home.classList.remove("show");
	search.classList.remove("show");
	editing.classList.add("show");
	page = "edit";
	return;
}

function showHomePage() {
	// update searchBar
	searchBar.value = "";
	// init tooltip
	initTooltip(); // for recents
	// abort card with priority
	if (controller_priority) {
		controller_priority.abort();
	}
	// show/hide content
	search.classList.remove("show");
	editing.classList.remove("show");
	home.classList.add("show");
	page = "home";
	return;
}

function showSearchPage() {
	// abort card with priority
	if (controller_priority) {
		controller_priority.abort();
	}
	editing.classList.remove("show");
	home.classList.remove("show");
	search.classList.add("show");
	page = "search";
	return;
}

function showToast(text, color) {
	while(toastBody.firstChild){
		toastBody.removeChild(toastBody.firstChild);
	}
	toastBody.insertAdjacentHTML("afterbegin", text);
	myToast.style.backgroundColor = color;
	const toast = new bootstrap.Toast(myToast, {
		delay: 4000
	});
	toast.show();
	return;
}

function removeSpinner(btn) {
	let spinner = btn.querySelector("span");
	if (spinner) {
		spinner.remove();
	}
	btn.disabled = false;
}

function initTooltip() {
	var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
	var tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
		tooltipTriggerEl.setAttribute("title", "<b>Status</b><br>0: Non annotata<br>1: Annotata automaticamente<br>2: Annotata manualmente");
		return new bootstrap.Tooltip(tooltipTriggerEl, tooltip_options);
	});
}

function updateRecents(cardToAdd) {
	let mediaScroller = container_Recents.querySelector(".media-scroller");
	let card = cards.find(c => c["id"] == cardToAdd);
	let idx = recents["list"].findIndex(c => c["id"] == cardToAdd);
	if (idx >= 0) {
		// update element
		recents["list"][idx] = card;
		let mediaElement = mediaScroller.querySelector(".media-element[data-id='" + cardToAdd + "']");
		mediaElement.querySelector(".status").textContent = "S:" + card["status"];
	}
	else {
		// add element
		recents["list"].push(card);
		let imgSrc = "server/resizedImages/" + card["filename"];
		let newElement = document.createElement("div");
		newElement.classList.add("media-element", "collapse", "show");
		newElement.setAttribute("data-id", card["id"]);
		newElement.setAttribute("data-cat", mapStatusCat(card["status"]));
		let newImg = document.createElement("img");
		newImg.setAttribute("src", imgSrc);
		newImg.setAttribute("loading", "lazy");
		let newFigcaption = document.createElement("figcaption");
		newFigcaption.classList.add("text-center", "pe-1");
		newFigcaption.textContent = card["id"];
		newElement.append(newImg);
		newElement.append(newFigcaption);
		let span = document.createElement("span");
		span.classList.add("float-end", "status");
		span.setAttribute("tabindex", "0");
		span.setAttribute("data-bs-toggle", "tooltip");
		span.setAttribute("data-bs-custom-class", "custom-tooltip");
		span.textContent = "S:" + card["status"];
		newFigcaption.append(span);
		mediaScroller.append(newElement);
	}
	sessionStorage.setItem("recents", JSON.stringify(recents["list"]));
	recentsContainer.classList.add("show");
	toggleSliderArrows(recentsContainer.querySelector(".media-scroller"));
	return;
}

function updateCursor(offset) {
	// case drawing
	if (drawSelected) {
		document.body.style.cursor = "crosshair";
		return;
	}

	for (const quad of quads) {

		// case corner --> Resize
		var closeCorner = quad.closeToCorner(offset);
		if (closeCorner) { // must shift-left closeCorner by 1
			closeCorner -= 1;
			let centroid = quad.centroid;
			if((offset.x < centroid.x && offset.y < centroid.y) || (offset.x > centroid.x && offset.y > centroid.y)) {
				document.body.style.cursor = "nwse-resize";
			}
			else {
				document.body.style.cursor = "nesw-resize";
			}
			return;
		}

		// case mid-point --> Resize
		var closeLine = quad.closeToSegmentMidpoint(offset);
		if(closeLine.bool) {
			if (closeLine.axis == "x") {
				document.body.style.cursor = "ew-resize";
			}
			else if (closeLine.axis == "y") {
				document.body.style.cursor = "ns-resize";
			}
			return;
		}

		// case inside --> Moving
		if (quad.isPointInside(offset)) {
			document.body.style.cursor = "move";
			return;
		}
	}
	document.body.style.cursor = "auto";
	return;
}

function mouseUp(e) {
	let new_dragoffset = {
		x: offsetConverter(e.offsetX, translatePos.x),
		y: offsetConverter(e.offsetY, translatePos.y)
	}
	mouseDown = false;

	if (justAclick) {
		lastQuadSelected = -1;
		toggleSelectedArea();
		draw();
	}

	if (e.button !== 0) {
		return;
	}

	if (!dragId) {
		return;
	}

	const quad = quads.find((t) => t.id === dragId);

	if (!quad) {
		return;
	}

	if (dragResize) {
		// update actionStack
		updateStack({
			action: "resize",
			id: quad.id,
			startingCorners: startingCorners,
			corners: JSON.parse(JSON.stringify(quad.corners)),
			label: quad.label,
			startingLabel: quad.label,
			color: quad.color
		});
	}

	if(dragMoving && JSON.stringify(startingCorners) != JSON.stringify(quad.corners)) {
		// update actionStack
		updateStack({
			action: "movement",
			id: quad.id,
			startingCorners: startingCorners,
			corners: JSON.parse(JSON.stringify(quad.corners)),
			label: quad.label,
			startingLabel: quad.label,
			color: quad.color
		});
	}

	if(resizeLine) {
		//update actionsStack
		updateStack({
			action: "resize",
			id: quad.id,
			startingCorners: startingCorners,
			corners: JSON.parse(JSON.stringify(quad.corners)),
			label: quad.label,
			startingLabel: quad.label,
			color: quad.color
		});
	}

	if (resizeRectangle) {
		if(quad.getArea() < 1000) {
			// quad too small --> REMOVE IT
			const idx = quads.findIndex((q) => q == quad);
			if(idx > -1) {
				lastQuadSelected = -1;
				toggleSelectedArea();
				quads.splice(idx, 1);
				if (quads.length < 1 && !sendingCards.includes(editingCard)) {
					startEditing.classList.add("show");
				}
			}
		}
		else {
			missingLabels.splice(0, 1);
			loadText(quad.label, "");
			lastQuadSelected = quad.id;
			toggleSelectedArea();
			updateStack({
				action: "generation",
				id: quad.id,
				startingCorners: JSON.parse(JSON.stringify(quad.corners)),
				corners: JSON.parse(JSON.stringify(quad.corners)),
				label: quad.label,
				startingLabel: quad.label,
				color: quad.color
			});
			drawToggle();
		}
	}

	dragId = undefined;
	dragOffset = undefined;
	dragResize = false;
	dragResizeIndex = undefined;
	resizeRectangle = false;
	resizeLine = false;
	resizeLineAxis = undefined;
	dragMoving = false;
	startingCorners = undefined;

	draw();

	document.body.style.cursor = "auto";
}

			
