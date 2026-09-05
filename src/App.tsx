/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Hub } from './pages/Hub';
import { LandingPage } from './pages/LandingPage';
import { SendPage } from './pages/SendPage';
import { ReceivePage } from './pages/ReceivePage';
import { HistoryPage } from './pages/HistoryPage';
import { QRApp } from './QRApp';
import { AirVaultApp } from './pages/AirVaultApp';
import { getShareParamsFromLocation } from './utils/share';

type Channel = 'hub' | 'sound' | 'qr' | 'airvault';
type SoundView = 'landing' | 'send' | 'receive' | 'history';

// If the app was opened via a share link (?share=...&m=qr|sound|vault), jump
// straight to that module's receive screen instead of the hub. Falls back to
// the hub if no module hint is present — the paste-link box still works from
// there once the person is on the right screen.
function initialChannelFromShareLink(): Channel {
  const shareParams = getShareParamsFromLocation();
  if (!shareParams?.module) return 'hub';
  if (shareParams.module === 'qr') return 'qr';
  if (shareParams.module === 'vault') return 'airvault';
  if (shareParams.module === 'sound') return 'sound';
  return 'hub';
}

export default function App() {
  const [channel, setChannel] = useState<Channel>(initialChannelFromShareLink);
  const [soundView, setSoundView] = useState<SoundView>(() =>
    initialChannelFromShareLink() === 'sound' ? 'receive' : 'landing'
  );

  // Initialize ggwave in the background once the sound channel is opened.
  useEffect(() => {
    if (channel === 'sound') {
      import('./audio/ggwaveManager').then(({ initGGWave }) => {
        initGGWave().catch(console.error);
      });
    }
  }, [channel]);

  if (channel === 'hub') {
    return (
      <Hub
        onSelectSound={() => setChannel('sound')}
        onSelectQR={() => setChannel('qr')}
        onSelectAirVault={() => setChannel('airvault')}
      />
    );
  }

  if (channel === 'qr') {
    return <QRApp onExit={() => setChannel('hub')} />;
  }

  if (channel === 'airvault') {
    return <AirVaultApp onExit={() => setChannel('hub')} />;
  }

  // channel === 'sound'
  return (
    <div className="w-full min-h-[100dvh] bg-[#020408] text-slate-200 flex flex-col font-sans overflow-x-hidden relative">
      <div className="fixed inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#3b82f6 0.5px, transparent 0.5px)', backgroundSize: '24px 24px' }}></div>
      <div className="fixed -top-40 -left-40 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="fixed -bottom-40 -right-40 w-96 h-96 bg-purple-600/10 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="relative z-10 flex flex-col flex-1">
        {soundView === 'landing' && (
          <LandingPage
            onStartSend={() => setSoundView('send')}
            onStartReceive={() => setSoundView('receive')}
            onViewHistory={() => setSoundView('history')}
            onExitHub={() => setChannel('hub')}
          />
        )}

        {soundView === 'send' && (
          <SendPage onBack={() => setSoundView('landing')} />
        )}

        {soundView === 'receive' && (
          <ReceivePage onBack={() => setSoundView('landing')} />
        )}

        {soundView === 'history' && (
          <HistoryPage onBack={() => setSoundView('landing')} />
        )}
      </div>
    </div>
  );
}
