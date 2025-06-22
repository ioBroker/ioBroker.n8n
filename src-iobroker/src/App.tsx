// Common
import React from 'react';

import { ThemeProvider, StyledEngineProvider } from '@mui/material/styles';

// Own
import { AdminConnection, Loader, GenericApp, type GenericAppState } from '@iobroker/adapter-react-v5';

import type { GenericAppProps } from '@iobroker/adapter-react-v5/build/types';

interface AppProps extends GenericAppProps {
    width: string;
}

interface AppState extends GenericAppState {
    lang: ioBroker.Languages;
    ready: boolean;
    selectedSceneId: string;
}

class App extends GenericApp<AppProps, AppState> {
    constructor(props: AppProps) {
        const extendedProps = { ...props };

        // @ts-expect-error fix later
        extendedProps.Connection = AdminConnection;

        super(props, extendedProps);
    }

    onConnectionReady(): void {
        const newState: Partial<AppState> = {
            lang: this.socket.systemLang,
            ready: false,
        };

        this.setState(newState as AppState);
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
                <ThemeProvider theme={this.state.theme}>
                    <div></div>
                </ThemeProvider>
            </StyledEngineProvider>
        );
    }
}

export default App;
