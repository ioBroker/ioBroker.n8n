const { copyFileSync } = require('node:fs');

function copyIcons() {
	copyFileSync(`${__dirname}/nodes/IoBrokerNodes/ioBroker.svg`, `${__dirname}/dist/nodes/IoBrokerNodes/ioBroker.svg`);
}

if (process.argv.includes('--build:icons')) {
	copyIcons();
}
