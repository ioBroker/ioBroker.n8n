function openSelectDialog(item, allowAll) {
	let selectDialog = document.getElementById('iob-select-id');

	window._iobOnSelected = function (newId, newObj, oldId, oldObj) {
		let selectDialog = document.getElementById('iob-select-id');
		if (selectDialog) {
			selectDialog.setAttribute('open', 'false');
		}

		if (newId) {
			item.value = newId;
			item.dispatchEvent(new Event('input'));
		}
	};

	if (!selectDialog) {
		selectDialog = document.createElement('iobroker-select-id');
		selectDialog.setAttribute('theme', 'dark');
		selectDialog.setAttribute('id', 'iob-select-id');
		selectDialog.setAttribute('port', window.ioBrokerAdmin.port);
		selectDialog.setAttribute('host', window.ioBrokerAdmin.host);
		selectDialog.setAttribute('protocol', window.ioBrokerAdmin.protocol);
		selectDialog.setAttribute('language', 'en');
		selectDialog.setAttribute('zindex', '2000');
		selectDialog.setAttribute('onclose', '_iobOnSelected');
		selectDialog.setAttribute('all', allowAll ? 'true' : 'false');
		selectDialog.setAttribute('selected', item.value);
		//		selectDialog.setAttribute('token', data?.access_token === 'not required' ? '' : JSON.stringify(data));
		selectDialog.setAttribute('open', 'true');
		document.body.appendChild(selectDialog);
	} else {
		console.log('reopenSelectDialog', item.value);
		selectDialog.setAttribute('all', allowAll ? 'true' : 'false');
		//		selectDialog.setAttribute('token', data?.access_token === 'not required' ? '' : JSON.stringify(data));
		selectDialog.setAttribute('selected', item.value);
		selectDialog.setAttribute('open', 'true');
	}
}

window.ioBrokerAdmin = {
	host: window.location.hostname,
	port: 5680,
	protocol: 'http:',
};

function detectIoBroker() {
	const items = document.querySelectorAll('.el-input__inner');
	if (items?.length) {
		items.forEach((item) => {
			if (item.placeholder?.includes('ioBroker')) {
				const button = item.parentNode.querySelector('.edit-window-button');
				if (button) {
					const existingButton = item.parentNode.querySelector('.iobroker-detected');
					if (!existingButton) {
						// Remove all existing event listeners to avoid duplicates
						const newButton = button.cloneNode(true);
						newButton.classList.add('iobroker-detected');
						// place new icon over the old one to avoid issues with vue.js
						button.parentNode.insertBefore(newButton, button);
						// Disable on button any user interaction
						button.style.pointerEvents = 'none';
						newButton.style.zIndex = '100';
						// Find svg inside the button to change the color
						const svg = newButton.querySelector('svg');
						svg.style.color = '#1eafff';

						newButton.addEventListener('click', (e) => {
							e.stopPropagation();
							console.log('iobroker detected');
							openSelectDialog(item, false);
						});
					}
				}
			}
		});
	}
}

// Just now no better way to detect iobroker
setInterval(detectIoBroker, 1000);
