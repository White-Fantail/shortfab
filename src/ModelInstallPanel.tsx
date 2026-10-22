import { useEffect, useState } from 'react';
import type { ModelInstallProgress } from './shared/stt';

type Props = {
  installed: boolean;
  installing: boolean;
  progress: ModelInstallProgress | null;
  startedAt: number;
  lastByteAt: number;
  disabled: boolean;
  onInstall: () => void;
  onCancel: () => void;
};

const formatMB = (bytes: number) => (bytes / 1_000_000).toFixed(1);
const timeElapsed = (seconds: number) => {
  const value = Math.max(0, Math.floor(seconds));
  return String(Math.floor(value / 60)).padStart(2, '0') + ':' +
    String(value % 60).padStart(2, '0');
};

/** Same installation feedback in AG2, AG4 and the advanced caption editor. */
export function ModelInstallPanel({ installed, installing, progress, startedAt,
  lastByteAt, disabled, onInstall, onCancel }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!installing) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [installing]);
  const stage = progress?.stage ?? 'checking';
  const percent = Math.max(0, Math.min(100, progress?.percent ?? 0));
  const downloaded = progress?.receivedBytes ?? 0;
  const total = progress?.totalBytes ?? 147_951_465;
  const quietSeconds = installing && stage === 'downloading' && lastByteAt
    ? Math.max(0, Math.floor((now - lastByteAt) / 1000)) : 0;
  const elapsed = installing && startedAt ? timeElapsed((now - startedAt) / 1000) : null;
  const hasStatus = !!progress && (installing || ['complete', 'cancelled', 'failed'].includes(progress.stage));
  return <div className="model-install-wrapper">
    {!installed && <button type="button" className="primary full"
      disabled={disabled || installing} onClick={onInstall}>
      {installing ? '다국어 모델 설치 진행 중…' :
        stage === 'failed' || stage === 'cancelled' ? '다국어 모델 다시 설치' :
          '기본 한국어·영어 모델 설치 (약 148MB)'}
    </button>}
    {hasStatus && <section aria-label="Whisper 모델 설치 상태"
      className={`model-install-status ${stage}`} role="status" aria-live="polite">
      <div className="model-install-header">
        <strong>{installing ? <span className="model-activity-dot" aria-hidden="true" /> :
          stage === 'complete' ? '✓ ' : '● '}{progress.message}</strong>
        <b>{percent}%</b>
      </div>
      <div className={`model-install-track ${installing && stage !== 'downloading' ? 'indeterminate' : ''}`}
        role="progressbar" aria-label="모델 설치 진행률"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div style={{ width: `${percent}%` }} />
      </div>
      <p className="model-install-meta">
        <span>{formatMB(downloaded)} / {formatMB(total)} MB</span>
        {elapsed && <span>경과 {elapsed}</span>}
      </p>
      {installing && stage === 'connecting' &&
        <p className="model-install-substatus">서버 응답을 기다리는 중입니다. 네트워크 상태에 따라 시간이 걸릴 수 있습니다.</p>}
      {installing && stage === 'downloading' && quietSeconds >= 12 &&
        <p className="model-install-substatus">최근 {quietSeconds}초간 새 데이터를 받지 못했습니다. 연결을 기다리는 중이며 취소할 수 있습니다.</p>}
      {installing && (stage === 'checking' || stage === 'verifying' || stage === 'registering') &&
        <p className="model-install-substatus">파일을 검사하고 있습니다. 이 단계에서는 용량이 늘어나지 않습니다.</p>}
      {installing && <button type="button" className="cancel full"
        onClick={onCancel}>모델 설치 취소</button>}
      {stage === 'failed' && <p className="model-install-substatus">네트워크·저장 공간을 확인한 후 위 버튼으로 다시 시도하세요. 검증에 실패한 파일은 설치되지 않습니다.</p>}
    </section>}
  </div>;
}
