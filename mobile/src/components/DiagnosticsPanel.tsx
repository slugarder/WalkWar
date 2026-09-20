import React, { useState } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';
import { diagnosticsEnabled, diagnosticReport } from '../device/diagnostics';
import { ActionButton, Label } from './UI';

export function DiagnosticsPanel() {
  const [report, setReport] = useState('');
  const [busy, setBusy] = useState(false);
  if (!diagnosticsEnabled) return null;
  const load = async () => {
    setBusy(true);
    try { setReport(await diagnosticReport()); }
    catch { setReport('진단 기록을 읽지 못했어요. 앱을 다시 열어 주세요.'); }
    finally { setBusy(false); }
  };
  return <View style={{ gap: 10 }}>
    <Label size={13} muted>WalkWar Debug · 기기·WebView·종료 기록</Label>
    <ActionButton secondary label="진단 기록 보기" disabled={busy} onPress={() => void load()}/>
    {!!report && <>
      <ScrollView nestedScrollEnabled style={{ maxHeight: 240, backgroundColor: '#101a28', borderRadius: 12 }}>
        <Text selectable style={{ color: '#dce7ef', fontSize: 12, padding: 12 }}>{report}</Text>
      </ScrollView>
      <ActionButton label="진단 기록 공유" onPress={() => void Share.share({ title: 'WalkWar 진단 기록', message: report }).catch(() => {})}/>
      <ActionButton secondary label="진단 기록 닫기" onPress={() => setReport('')}/>
    </>}
  </View>;
}
