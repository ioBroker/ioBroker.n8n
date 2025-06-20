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
		console.log('openSelectDialog', item.value);
		selectDialog = document.createElement('iobroker-select-id');
		selectDialog.setAttribute('theme', 'dark');
		//selectDialog.setAttribute('primary', '#AD1625');
		//selectDialog.setAttribute('secondary', 'rgb(228, 145, 145)');
		//selectDialog.setAttribute('paper', 'rgb(243, 243, 243)');
		selectDialog.setAttribute('id', 'iob-select-id');
		selectDialog.setAttribute('port', window.ioBrokerAdmin.port);
		selectDialog.setAttribute('host', window.ioBrokerAdmin.host);
		selectDialog.setAttribute('protocol', window.ioBrokerAdmin.protocol);
		selectDialog.setAttribute('language', 'en');
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
	// Temporary workaround for z-index issue
	setTimeout(() => {
		const dialog = document.querySelector('.MuiDialog-root');
		if (dialog) {
			dialog.style.zIndex = '2000';
		}
	}, 200);
}

window.ioBrokerAdmin = {
	host: window.location.hostname,
	port: 8081,
	protocol: 'http:',
};

function detectIoBroker() {
    const items = document.querySelectorAll('.el-input__inner');
    if (items?.length) {
        items.forEach(item => {
            if (item.placeholder?.includes('ioBroker')) {
                const button = item.parentNode.querySelector('.edit-window-button');
                if (button && !button.classList.contains('iobroker-detected')) {
                    button.classList.add('iobroker-detected');
										// Find svg inside the button
										const svg = button.querySelector('svg');
										svg.style.color = '#1eafff';

                    // Remove all existing event listeners to avoid duplicates
                    const newButton = button.cloneNode(true);
                    button.parentNode.replaceChild(newButton, button);
                    newButton.addEventListener('click', () => {
											console.log('iobroker detected');
											openSelectDialog(item, false);
                    });
                }
            }
        });
    }
}

// Just now no better way to detect iobroker
setInterval(detectIoBroker, 1000);
