import { NativeModules } from 'react-native';

type Diagnostics = {
  enabled: boolean;
  recordEvent(kind: string, details: string): void;
  getReport(): Promise<string>;
};
const diagnostics = NativeModules.WalkWarDiagnostics as Diagnostics | undefined;
export const diagnosticsEnabled = diagnostics?.enabled === true;

export function recordDiagnostic(kind: string, details = '') {
  if (!diagnosticsEnabled) return;
  try { diagnostics?.recordEvent(kind.slice(0, 50), details.slice(0, 300)); } catch {}
}

export async function diagnosticReport(): Promise<string> {
  if (!diagnosticsEnabled || !diagnostics) return '이 빌드는 진단 정보를 수집하지 않습니다.';
  const report = await diagnostics.getReport();
  try { return JSON.stringify(JSON.parse(report), null, 2); } catch { return report; }
}

recordDiagnostic('js-start');
