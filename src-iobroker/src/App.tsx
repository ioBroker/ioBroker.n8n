// Common
import React from 'react';

import { ThemeProvider, StyledEngineProvider } from '@mui/material/styles';

// Own
import {
    AdminConnection,
    Loader,
    GenericApp,
    type GenericAppState,
    type GenericAppProps,
    SelectID,
} from '@iobroker/adapter-react-v5';

interface AppState extends GenericAppState {
    lang: ioBroker.Languages;
    ready: boolean;
    showSelectId: boolean;
    selectedId: string | undefined;
}

class App extends GenericApp<GenericAppProps, AppState> {
    private channel = new BroadcastChannel('ioBrokerChannel');

    constructor(props: GenericAppProps) {
        const extendedProps = { ...props };

        // @ts-expect-error fix later
        extendedProps.Connection = AdminConnection;
        extendedProps.socket = {
            name: 'Selector',
            port: 5680,
        };

        super(props, extendedProps);
        this.channel.onmessage = event => {
            if (event.data === 'close') {
                window.close();
            }
        };
    }

    onConnectionReady(): void {
        const newState: Partial<AppState> = {
            lang: this.socket.systemLang,
            ready: true,
            showSelectId: true,
        };

        this.setState(newState as AppState);
    }

    renderSelectId(): React.JSX.Element | null {
        if (!this.state.showSelectId) {
            return null;
        }
        return (
            <SelectID
                socket={this.socket}
                theme={this.state.theme}
                onClose={() => {
                    this.setState({ showSelectId: true, selectedId: '' });
                    this.channel.postMessage({
                        type: 'cancel',
                    });
                }}
                onOk={id => {
                    const oid = Array.isArray(id) ? id[0] : id;
                    this.setState({ showSelectId: true, selectedId: oid });
                    this.channel.postMessage({
                        type: 'selected',
                        newId: oid,
                    });
                }}
            />
        );
    }

    render(): React.JSX.Element {
        if (!this.state.ready) {
            return (
                <StyledEngineProvider injectFirst>
                    <ThemeProvider theme={this.state.theme}>
                        <Loader themeName={this.state.themeName} />
                    </ThemeProvider>
                </StyledEngineProvider>
            );
        }

        return (
            <StyledEngineProvider injectFirst>
                <ThemeProvider theme={this.state.theme}>{this.renderSelectId()}</ThemeProvider>
            </StyledEngineProvider>
        );
    }
}

export default App;
