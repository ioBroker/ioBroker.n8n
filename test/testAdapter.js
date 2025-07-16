/* jshint -W097 */
/* jshint strict: false */
/* jslint node: true */
const expect = require('chai').expect;
const setup = require('@iobroker/legacy-testing');
const http = require('node:http');

let objects = null;
let states = null;
let onStateChanged = null;

const adapterShortName = setup.adapterName.substring(setup.adapterName.indexOf('.') + 1);
const runningMode = require('../io-package.json').common.mode;

function checkConnectionOfAdapter(cb, counter) {
    counter ||= 0;
    console.log(`Try check #${counter}`);
    if (counter > 120) {
        return cb?.('Cannot check connection');
    }

    states.getState(`system.adapter.${adapterShortName}.0.alive`, (err, state) => {
        if (err) {
            console.error(err);
        }
        if (state?.val) {
            cb?.();
        } else {
            setTimeout(() => checkConnectionOfAdapter(cb, counter + 1), 1000);
        }
    });
}

function waitForGUI(cb, counter) {
    counter ||= 0;
    if (counter > 120) {
        return cb?.('Cannot connect to GUI');
    }
    console.log(`Check GUI #${counter}`);

    http.get(`http://localhost:5678`, res => {
        if (res.statusCode === 200) {
            cb?.();
        } else {
            setTimeout(() => waitForGUI(cb, counter + 1), 1000);
        }
    }).on('error', err => {
        setTimeout(() => waitForGUI(cb, counter + 1), 1000);
    });
}

describe(`Test ${adapterShortName} adapter`, function () {
    before(`Test ${adapterShortName} adapter: Start js-controller`, function (_done) {
        this.timeout(600000); // because of the first installation from npm

        setup.setupController(async () => {
            const config = await setup.getAdapterConfig();
            // enable adapter
            config.common.enabled = true;
            config.common.loglevel = 'debug';

            //config.native.dbtype   = 'sqlite';

            await setup.setAdapterConfig(config.common, config.native);

            setup.startController(
                true,
                (id, obj) => {},
                (id, state) => onStateChanged?.(id, state),
                (_objects, _states) => {
                    objects = _objects;
                    states = _states;
                    _done();
                },
            );
        });
    });

    it(`Test ${adapterShortName} instance object: it must exists`, function (done) {
        objects.getObject(`system.adapter.${adapterShortName}.0`, function (err, obj) {
            expect(err).to.be.null;
            expect(obj).to.be.an('object');
            expect(obj).not.to.be.null;
            done();
        });
    });

    it(`Test ${adapterShortName} adapter: Check if adapter started`, function (done) {
        this.timeout(180000);
        checkConnectionOfAdapter(function (res) {
            if (res) {
                console.log(res);
            }
            if (runningMode === 'daemon') {
                expect(res).not.to.be.equal('Cannot check connection');
            } else {
                //??
            }
            done();
        });
    });

    it(`Test ${adapterShortName} adapter: Check if GUI is alive`, function (done) {
        this.timeout(180000);
        // Read http://localhost:5678
        waitForGUI(function (res) {
            expect(res).not.to.be.equal('Cannot connect to GUI');
            if (res) {
                console.log(res);
            } else {
                done();
            }
        });
    });

    after(`Test ${adapterShortName} adapter: Stop js-controller`, function (done) {
        this.timeout(10000);

        setup.stopController(normalTerminated => {
            console.log(`Adapter normal terminated: ${normalTerminated}`);
            done();
        });
    });
});
