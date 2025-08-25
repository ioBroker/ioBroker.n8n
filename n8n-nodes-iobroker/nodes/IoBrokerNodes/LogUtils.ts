import { gunzipSync } from 'node:zlib';

function readLogFile(adapter: ioBroker.Adapter, host: string, fileName: string): Promise<string> {
	return new Promise((resolve, reject) => {
		if (host.startsWith('system.host.')) {
			host = host.substring('system.host.'.length);
		}
		// Parse file name into host name and transport: log/MSI/file1/ReadMe.log
		const [, hostName, transport, ...shortFileName] = fileName.split('/');
		console.log(
			`Reading log file ${shortFileName.join('/')} from host ${host} (${hostName}) via ${transport}`,
		);

		adapter.sendToHost(
			`system.host.${hostName}`,
			'getLogFile',
			{ filename: shortFileName.join('/'), transport },
			(result) => {
				const _result = result as { error?: string; data?: string; size?: number; gz?: boolean };
				if (!_result || _result.error) {
					if (_result.error) {
						adapter.log.warn(`Cannot read log file ${fileName}: ${_result.error}`);
					}
					reject(new Error(_result.error));
				} else {
					if (_result.gz && _result.data) {
						try {
							resolve(gunzipSync(_result.data).toString('utf8'));
						} catch {
							reject(new Error(`Cannot unzip log file ${fileName}`));
						}
					} else if (_result.data === undefined || _result.data === null) {
						reject(new Error(`Cannot read log file ${fileName}: empty result`));
					} else {
						resolve(_result.data.toString());
					}
				}
			},
		);
	});
}

function getLogFiles(
	adapter: ioBroker.Adapter,
	host: string,
): Promise<{ fileName: string; size: number }[]> {
	return new Promise((resolve, reject) => {
		if (host.startsWith('system.host.')) {
			host = host.substring('system.host.'.length);
		}
		let timeout: NodeJS.Timeout | null = setTimeout(() => {
			timeout = null;
			reject(new Error('timeout'));
		}, 30000);

		adapter.sendToHost(host, 'getLogFiles', null, (result: any): void => {
			const answer: { error?: string; list?: { fileName: string; size: number }[] } = result;
			if (timeout) {
				clearTimeout(timeout);
				timeout = null;
			}
			if (!answer) {
				reject(new Error('no response'));
				return;
			}
			if (answer.error) {
				reject(new Error(answer.error));
				return;
			}
			if (!answer.list) {
				reject(new Error('no list'));
				return;
			}
			resolve(
				answer.list.filter(
					(file) => file.fileName && !file.fileName.endsWith('ReadMe.log') && file.size > 0,
				),
			);
		});
	});
}

export async function readLastLogFile(
	adapter: ioBroker.Adapter,
	level?: ioBroker.LogLevel,
	instance?: string,
	count?: number,
): Promise<ioBroker.LogMessage[]> {
	// first find host
	const instanceObj = await adapter.getForeignObjectAsync(`system.adapter.${adapter.namespace}`);
	if (!instanceObj?.common?.host) {
		throw new Error('Cannot find instance or host');
	}
	const host = instanceObj.common.host;
	// now get log files
	const logFiles = await getLogFiles(adapter, host);
	if (!logFiles?.length) {
		return [];
	}
	// sort files by date
	logFiles.sort((a, b) => {
		if (a.fileName > b.fileName) {
			return -1;
		}
		if (a.fileName < b.fileName) {
			return 1;
		}
		return 0;
	});
	// read the last file
	const logContent = await readLogFile(adapter, host, logFiles[0].fileName);
	// split into lines
	const lines = logContent.split('\n');
	const logMessages: ioBroker.LogMessage[] = [];
	for (let l = lines.length - 1; l >= 0; l--) {
		const line = lines[l].trim();
		if (line) {
			// example line: "2025-08-23 23:37:53.529 - error: nmea.0 (1781) NGT1: Error: No such file or directory, cannot open /dev/ttyUSB0"
			// find first space
			const time = line.substring(0, '2025-08-23 23:37:53.529'.length);
			let rest = line.substring('2025-08-23 23:37:53.529'.length + 3).trim();
			// find colon
			const colon = rest.indexOf(':');
			if (colon === -1) {
				continue;
			}
			const severity: ioBroker.LogLevel = rest
				.substring(0, colon)
				.trim()
				.toLowerCase() as ioBroker.LogLevel;
			rest = rest.substring(colon + 1).trim();
			// find first space
			const firstSpace = rest.indexOf(' ');
			if (firstSpace === -1) {
				continue;
			}
			const from = rest.substring(0, firstSpace).trim();
			rest = rest.substring(firstSpace + 1).trim();
			const ts = new Date(time).getTime();
			const msg: ioBroker.LogMessage = {
				message: rest,
				ts,
				severity,
				from,
				_id: ts,
			};

			if (level && msg.severity !== level) {
				continue;
			}
			if (instance && msg.from !== instance) {
				continue;
			}
			if (count && logMessages.length >= count) {
				break;
			}
			logMessages.push(msg);
		}
	}
	return logMessages;
}
