import { useEffect, useRef, useState } from 'react';
import { CLIP_TIME_EPSILON, MIN_CLIP_SECONDS, youtubeVideoId, type RenderProgress } from './shared/contracts';
import { YouTubePreview, type YouTubeControls } from './YouTubePreview';
import {
  projectEditValidationError,
  type ProjectClip, type ProjectEdits, type ProjectSummary, type ProjectView,
} from './shared/projects';
import type { BindSourceRequest } from './shared/sources';
import { SUBTITLE_PRESETS, type SubtitleTrack } from './shared/subtitles';
import { MAX_STT_SECONDS, type SttLanguage, type SttStatus } from './shared/stt';
import type { PublishDraft, PublishJobView, PublishOverview, YouTubePrivacy } from './shared/publishing';
import { WizardPanel, WizardProgress } from './WizardPanel';
import { WIZARD_STEPS, acceptStep, newWizard, normalizeWizard, reconcileWizard, skipStep, type WizardFields, type WizardStep } from './shared/wizard';

type SourceTab = 'local' | 'youtube';
type OutputTab = 'export' | 'publish';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00';
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function editorData(view: ProjectView): ProjectEdits {
  return {
    id: view.id, revision: view.revision, title: view.title,
    youtubeUrl: view.youtubeUrl, youtubeDuration: view.youtubeDuration, clips: view.clips,
    selectedClipId: view.selectedClipId, wizard: normalizeWizard(view.wizard, view.clips),
  };
}

function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<ProjectView | null>(null);
  const [draft, setDraft] = useState<ProjectEdits | null>(null);
  const [sourceTab, setSourceTab] = useState<SourceTab>('youtube');
  const [wizardMode, setWizardMode] = useState(true);
  const [loopClip, setLoopClip] = useState(false);
  const [cloudUrl, setCloudUrl] = useState('');
  const [cloudError, setCloudError] = useState('');
  const [cloudBusy, setCloudBusy] = useState(false);
  const [partnerConfigured, setPartnerConfigured] = useState(false);
  const [partnerBusy, setPartnerBusy] = useState(false);
  const [partnerError, setPartnerError] = useState('');
  const [rightsForm, setRightsForm] = useState<BindSourceRequest>({
    rightsHolder: '', evidenceRef: '', allowClip: false, allowDerivativeEdit: false,
    allowRepost: false, expiresAt: null, expectedSha256: null, startOffsetSeconds: 0,
  });
  const [outputTab, setOutputTab] = useState<OutputTab>('export');
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const isScrubbing = useRef(false);
  const [progress, setProgress] = useState<RenderProgress>({ percent: 0, seconds: 0 });
  const [personalToolReady, setPersonalToolReady] = useState<boolean | null>(null);
  const [rendering, setRendering] = useState(false);
  const [sttBusy, setSttBusy] = useState(false);
  const [modelInstalling, setModelInstalling] = useState(false);
  const [sttLanguage, setSttLanguage] = useState<SttLanguage>('auto');
  const [sttSetup, setSttSetup] = useState<SttStatus | null>(null);
  const [sttMessage, setSttMessage] = useState('');
  const [publishing, setPublishing] = useState<PublishOverview | null>(null);
  const [publishingBusy, setPublishingBusy] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [publishMessage, setPublishMessage] = useState('');
  const [publishForm, setPublishForm] = useState<{
    title: string; description: string; privacyStatus: YouTubePrivacy; madeForKids: boolean | null;
  }>({ title: '', description: '', privacyStatus: 'private', madeForKids: null });
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('프로젝트를 불러오는 중입니다.');
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const youtubePlayer = useRef<YouTubeControls>(null);
  const projectRef = useRef<ProjectView | null>(null);
  const draftRef = useRef<ProjectEdits | null>(null);
  const dirtyRef = useRef(false);
  const editVersion = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  const clip = draft?.clips.find((item) => item.id === draft.selectedClipId && item.source === sourceTab);
  const wizard = draft?.wizard ?? newWizard(draft?.clips ?? []);
  const visibleClips = draft?.clips.filter((item) => item.source === sourceTab) ?? [];
  const media = project?.media ?? null;
  const youtubeId = youtubeVideoId(draft?.youtubeUrl ?? '');
  const sourceConnected = project?.sourceStatus === 'connected';
  const sourceDuration = sourceTab === 'youtube' ? draft?.youtubeDuration ?? null : media?.duration ?? null;
  const draftValidationError = draft ? projectEditValidationError(draft, media?.duration ?? null) : null;
  const currentTime = Math.max(0, Math.min(scrubTime ?? playhead, sourceDuration ?? 0));
  const activeCaption = clip?.subtitles?.cues.find((cue) =>
    currentTime >= clip.start + cue.start && currentTime < clip.start + cue.end && cue.text.trim());
  const validClip = Boolean(clip && sourceDuration !== null &&
    Number.isFinite(clip.start) && Number.isFinite(clip.end) &&
    clip.start >= 0 && clip.end - clip.start >= MIN_CLIP_SECONDS - CLIP_TIME_EPSILON && clip.end <= sourceDuration + 0.02);
  const linked = project?.youtubeSource;
  const linkedAsset = linked?.state === 'ready_to_render' && linked.binding?.referenceVideoId === youtubeId
    ? linked.binding : null;
  // A public YouTube clip can be fetched on demand for personal export.
  const canRender = validClip && !draftValidationError && !rendering && !busy && !publishingBusy && !sttBusy && (
    (sourceTab === 'local' && clip?.source === 'local' && sourceConnected) ||
    (sourceTab === 'youtube' && clip?.source === 'youtube' && !!youtubeId)
  );
  const publishReady = publishing?.artifact?.projectId === project?.id &&
    publishing?.artifact?.clipId === clip?.id &&
    publishing?.artifact?.start === clip?.start &&
    publishing?.artifact?.end === clip?.end &&
    publishing?.artifact?.width === clip?.width &&
    publishing?.artifact?.subtitleSignature === JSON.stringify(clip?.subtitles ?? null) &&
    publishing?.artifact?.sourceBindingId === (clip?.source === 'youtube' ? linkedAsset?.sourceAssetId ?? null : null);
  const projectJobs = publishing?.jobs.filter((item) => item.projectId === project?.id) ?? [];
  const canPublish = publishReady &&
    (clip?.source !== 'youtube' || (linked?.canPublishYouTube && linkedAsset !== null)) &&
    publishing?.connected && !dirty && !rendering && !busy &&
    !publishingBusy && publishForm.madeForKids !== null && Boolean(publishForm.title.trim());

  function applyView(view: ProjectView) {
    const edits = editorData(view);
    projectRef.current = view;
    draftRef.current = edits;
    dirtyRef.current = false;
    editVersion.current += 1;
    setProject(view);
    setDraft(edits);
    setWizardMode(true);
    setCloudUrl(''); // Never carry credential-bearing signed URLs across projects.
    setCloudError('');
    setPartnerError('');
    const linkedRights = view.youtubeSource.binding;
    setRightsForm(linkedRights ? {
      rightsHolder: linkedRights.rights.rightsHolder,
      evidenceRef: linkedRights.rights.evidenceRef,
      allowClip: linkedRights.rights.allowClip,
      allowDerivativeEdit: linkedRights.rights.allowDerivativeEdit,
      allowRepost: linkedRights.rights.allowRepost,
      expiresAt: linkedRights.rights.expiresAt,
      startOffsetSeconds: linkedRights.startOffsetSeconds,
      expectedSha256: linkedRights.sha256,
    } : {
      rightsHolder: '', evidenceRef: '', allowClip: false, allowDerivativeEdit: false,
      allowRepost: false, expiresAt: null, expectedSha256: null, startOffsetSeconds: 0,
    });
    setDirty(false);
    setSourceTab(view.clips.find((c) => c.id === view.selectedClipId)?.source ?? (view.media ? 'local' : 'youtube'));
    setLoopClip(false);
    setPlaying(false);
    isScrubbing.current = false;
    setScrubTime(null);
    setPlayhead(view.clips.find((c) => c.id === view.selectedClipId)?.start ?? 0);
    setProgress({ percent: 0, seconds: 0 });
    setStatus(`프로젝트: ${view.title} · ${view.clips.length}개 클립`);
    setError('');
  }

  async function refreshPublishing() {
    if (!window.shortfab) return;
    try {
      const overview = await window.shortfab.publishOverview();
      setPublishing(overview);
    } catch (cause) {
      // Credential errors must never make local editing or MP4 export appear to fail.
      setPublishing(null);
      setPublishError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    setPublishForm((current) => ({
      ...current, title: (clip?.title ?? project?.title ?? '').slice(0, 100),
    }));
  }, [clip?.id, project?.id]);

  async function youtubeAction(action: () => Promise<unknown>, success: string) {
    if (!window.shortfab || publishingBusy || rendering || busy) return;
    setPublishingBusy(true);
    setPublishError('');
    try {
      const result = await action();
      setPublishMessage(result === null ? '작업이 취소되었습니다.' : success);
    } catch (cause) {
      setPublishError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      await refreshPublishing();
      setPublishingBusy(false);
    }
  }

  function onPublished(job: PublishJobView) {
    setPublishing((previous) => previous ? {
      ...previous, jobs: [job, ...previous.jobs.filter((entry) => entry.id !== job.id)].slice(0, 20),
    } : previous);
  }

  async function refreshProjects() {
    if (window.shortfab) setProjects(await window.shortfab.listProjects());
  }

  useEffect(() => {
    let live = true;
    const unsubscribePublish = window.shortfab?.onPublishProgress((value) => {
      if (live) onPublished(value.job);
    });
    const unsubscribe = window.shortfab?.onProgress((value) => {
      if (live) {
        setProgress(value);
        if (value.phase === 'download') setStatus('YouTube 영상 가져오는 중…');
        else if (value.phase === 'render') setStatus('세로형 MP4 인코딩 중…');
      }
    });
    const unsubscribeStt = window.shortfab?.onSttProgress((event) => {
      if (live) setSttMessage(event.message);
    });
    if (window.shortfab) {
      void window.shortfab.sttStatus()
        .then((result) => { if (live) setSttSetup(result); })
        .catch(() => { if (live) setSttSetup(null); });
      void window.shortfab.personalToolAvailable()
        .then((ready) => { if (live) setPersonalToolReady(ready); })
        .catch(() => { if (live) setPersonalToolReady(false); });
      void window.shortfab.partnerCatalogStatus()
        .then(({ configured }) => { if (live) setPartnerConfigured(configured); })
        .catch(() => { if (live) setPartnerConfigured(false); });
    }
    if (!window.shortfab) {
      setError('프로젝트 저장과 렌더는 Electron 데스크톱 앱에서만 실행됩니다. npm run dev를 사용하세요.');
    } else {
      void (async () => {
        try {
          const list = await window.shortfab!.listProjects();
          const view = list.length
            ? await window.shortfab!.openProject(list[0].id)
            : await window.shortfab!.createProject();
          if (!live) return;
          applyView(view);
          await refreshProjects();
          await refreshPublishing();
        } catch (cause) {
          if (live) setError(cause instanceof Error ? cause.message : String(cause));
        }
      })();
    }
    return () => { live = false; unsubscribe?.(); unsubscribePublish?.(); unsubscribeStt?.(); };
  }, []);

  function changeDraft(update: (current: ProjectEdits) => ProjectEdits) {
    const old = draftRef.current;
    if (!old || publishingBusy) return;
    const candidate = update(old);
    if (candidate === old) return;
    const next = { ...candidate, wizard: reconcileWizard(candidate.wizard, old, candidate) };
    draftRef.current = next;
    dirtyRef.current = true;
    editVersion.current += 1;
    setDraft(next);
    setDirty(true);
  }

  function queueSave(snapshot: ProjectEdits, version: number): Promise<void> {
    if (!window.shortfab) return Promise.resolve();
    const task = saveQueue.current.then(async () => {
      const active = projectRef.current;
      if (!active || active.id !== snapshot.id) return;
      const issue = projectEditValidationError(snapshot, active.media?.duration ?? null);
      if (issue) throw new Error(`저장 전 수정 필요: ${issue}`);
      const updated = await window.shortfab!.saveProject({ ...snapshot, revision: active.revision });
      if (projectRef.current?.id !== updated.id) return;
      projectRef.current = updated;
      setProject(updated);
      setProjects((items) => items.map((item) => item.id === updated.id ? {
        ...item, title: updated.title, updatedAt: updated.updatedAt,
        clipCount: updated.clips.length, sourceName: updated.sourceName,
      } : item));
      if (editVersion.current === version) {
        dirtyRef.current = false;
        setDirty(false);
        setError('');
        setStatus(`프로젝트 저장됨 · ${updated.clips.length}개 클립`);
      }
    });
    saveQueue.current = task.catch(() => {});
    return task;
  }

  useEffect(() => {
    if (!dirty || !draft || draftValidationError || busy || rendering || publishingBusy) return;
    const timer = setTimeout(() => {
      void queueSave(draft, editVersion.current).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    }, 650);
    return () => clearTimeout(timer);
  }, [draft, dirty, draftValidationError, busy, rendering, publishingBusy]);

  async function flushEdits() {
    if (dirtyRef.current && draftRef.current) {
      const issue = projectEditValidationError(draftRef.current, projectRef.current?.media?.duration ?? null);
      if (issue) throw new Error(`저장 전 수정 필요: ${issue}`);
      await queueSave(draftRef.current, editVersion.current);
    } else {
      await saveQueue.current;
    }
  }

  async function openProject(id: string) {
    if (!window.shortfab || busy || rendering || publishingBusy || projectRef.current?.id === id) return;
    setBusy(true);
    try {
      await flushEdits();
      const opened = await window.shortfab.openProject(id);
      applyView(opened);
      await refreshProjects();
      await refreshPublishing();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function newProject() {
    if (!window.shortfab || busy || rendering || publishingBusy) return;
    setBusy(true);
    try {
      await flushEdits();
      const created = await window.shortfab.createProject();
      applyView(created);
      await refreshProjects();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function chooseMedia(reconnect: boolean) {
    if (!window.shortfab || busy || rendering || publishingBusy) return;
    setBusy(true);
    setError('');
    try {
      await flushEdits();
      const updated = reconnect
        ? await window.shortfab.reconnectMedia()
        : await window.shortfab.pickMedia();
      if (!updated) return;
      applyView(updated);
      setSourceTab('local');
      await refreshProjects();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function discoverPartnerSource() {
    if (!window.shortfab || !partnerConfigured || !youtubeId ||
        !draft?.youtubeDuration || busy || rendering || publishingBusy) return;
    setBusy(true);
    setPartnerBusy(true);
    setPartnerError('');
    try {
      await flushEdits();
      const updated = await window.shortfab.bindPartnerSource();
      applyView(updated);
      setSourceTab('youtube');
      setStatus('파트너 서명, 영상 ID, 이용 권한 및 SHA-256을 검증해 원본을 자동 연결했습니다.');
    } catch (cause) {
      setPartnerError(cause instanceof Error ? cause.message : '파트너 원본 탐색에 실패했습니다.');
    } finally {
      setBusy(false);
      setPartnerBusy(false);
    }
  }

  async function bindApprovedCloudSource() {
    if (!window.shortfab || !youtubeId || !draft?.youtubeDuration || busy || rendering || publishingBusy) return;
    setBusy(true);
    setCloudBusy(true);
    setCloudError('');
    try {
      await flushEdits();
      const updated = await window.shortfab.bindCloudSource({ directUrl: cloudUrl.trim(), rights: rightsForm });
      applyView(updated);
      setCloudUrl(''); // Signed URL may contain a short-lived token; do not persist it.
      setSourceTab('youtube');
      setStatus('허용된 저장소의 원본 SHA-256 및 파일 연결을 확인했습니다.');
    } catch (cause) {
      setCloudError(cause instanceof Error ? cause.message : '원격 원본 연결에 실패했습니다.');
    } finally {
      setCloudBusy(false);
      setBusy(false);
    }
  }

  async function bindAuthorizedSource() {
    if (!window.shortfab || !youtubeId || !draft?.youtubeDuration || rendering || busy || publishingBusy) return;
    setBusy(true);
    setError('');
    try {
      await flushEdits();
      const updated = await window.shortfab.bindYouTubeMedia(rightsForm);
      if (!updated) return;
      applyView(updated);
      setSourceTab('youtube');
      setStatus('YouTube ID와 원본 체크섬을 연결했습니다. 법적 권리는 사용자 확인 사항입니다.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  function selectSource(next: SourceTab) {
    setPlaying(false);
    isScrubbing.current = false;
    setScrubTime(null);
    setSourceTab(next);
    setPlayhead(0);
    changeDraft((current) => {
      const first = current.clips.find((item) => item.source === next)?.id;
      return first && first !== current.selectedClipId ? { ...current, selectedClipId: first } : current;
    });
  }

  function setYoutubeUrl(value: string) {
    setPlaying(false);
    isScrubbing.current = false;
    setScrubTime(null);
    setCloudUrl('');
    setCloudError('');
    setPartnerError('');
    if (youtubeVideoId(draftRef.current?.youtubeUrl ?? '') !== youtubeVideoId(value)) {
      // Never carry declarations of one video's rights across to another video ID.
      setRightsForm({
        rightsHolder: '', evidenceRef: '', allowClip: false, allowDerivativeEdit: false,
        allowRepost: false, expiresAt: null, expectedSha256: null, startOffsetSeconds: 0,
      });
    }
    changeDraft((current) => {
      const previous = youtubeVideoId(current.youtubeUrl);
      const incoming = youtubeVideoId(value);
      if (previous === incoming) return { ...current, youtubeUrl: value };
      // Orphaned local clips left by older projects cannot render without an attached asset.
      // Do not carry them into a new YouTube-only project.
      const clips = current.clips.filter((item) =>
        item.source !== 'youtube' && (item.source !== 'local' || !!projectRef.current?.media));
      return { ...current, youtubeUrl: value, youtubeDuration: null, clips,
        selectedClipId: clips.find((item) => item.id === current.selectedClipId)?.id ?? clips[0]?.id ?? null };
    });
    setPlayhead(0);
  }

  function onYoutubeDuration(id: string, seconds: number) {
    changeDraft((current) => {
      if (youtubeVideoId(current.youtubeUrl) !== id ||
          (current.youtubeDuration !== null && Math.abs(current.youtubeDuration - seconds) < 0.15) ||
          current.clips.some((item) => item.source === 'youtube' && item.end > seconds + 0.02)) return current;
      return { ...current, youtubeDuration: seconds };
    });
  }

  function updateClip(patch: Partial<ProjectClip>) {
    changeDraft((current) => ({
      ...current,
      clips: current.clips.map((candidate) =>
        candidate.id === current.selectedClipId ? { ...candidate, ...patch } : candidate),
    }));
  }

  function updateSubtitles(edit: (value: SubtitleTrack) => SubtitleTrack) {
    if (!clip) return;
    updateClip({ subtitles: edit(clip.subtitles ?? { preset: 'classic', cues: [] }) });
  }

  function addCaption() {
    if (!clip || (clip.subtitles?.cues.length ?? 0) >= 30 || clip.end - clip.start < 0.1) return;
    const duration = clip.end - clip.start;
    const from = Math.max(0, Math.min(duration - 0.1, currentTime - clip.start));
    updateSubtitles((value) => ({
      ...value, cues: [...value.cues, {
        id: crypto.randomUUID(), start: Number(from.toFixed(2)),
        end: Number(Math.min(duration, from + 3).toFixed(2)), text: '',
      }],
    }));
  }

  function updateCaption(id: string, patch: Partial<SubtitleTrack['cues'][number]>) {
    updateSubtitles((value) => ({
      ...value, cues: value.cues.map((cue) => cue.id === id ? { ...cue, ...patch } : cue),
    }));
  }

  function removeCaption(id: string) {
    updateSubtitles((value) => ({
      ...value, cues: value.cues.filter((cue) => cue.id !== id),
    }));
  }

  async function installSttModel() {
    if (!window.shortfab || busy || rendering || publishingBusy || sttBusy || modelInstalling) return;
    setModelInstalling(true);
    setBusy(true);
    setSttMessage('기본 다국어 AI 모델을 안전하게 내려받는 중…');
    try {
      const status = await window.shortfab.installSttModel();
      setSttSetup(status);
      setSttMessage(status.modelAvailable
        ? '기본 다국어 AI 모델 설치 완료. 언어를 선택하고 자동 자막 생성을 누르세요.'
        : '모델 다운로드가 취소되었습니다. 기존 자막은 유지됩니다.');
    } catch (cause) {
      setSttMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setModelInstalling(false);
      setBusy(false);
    }
  }

  async function chooseSttModel() {
    if (!window.shortfab || busy || rendering || publishingBusy || sttBusy) return;
    setBusy(true);
    setSttMessage('');
    try {
      setSttSetup(await window.shortfab.chooseSttModel());
    } catch (cause) {
      setSttMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function generateSubtitles() {
    if (!clip || !window.shortfab || !validClip || !!draftValidationError ||
        busy || rendering || publishingBusy || sttBusy ||
        !sttSetup?.engineAvailable || !sttSetup.modelAvailable) return;
    const duration = clip.end - clip.start;
    if (duration > MAX_STT_SECONDS) {
      setSttMessage('자동 자막은 10분 이하 클립에서 지원합니다. IN/OUT을 짧게 지정해 주세요.');
      return;
    }
    if (clip.subtitles?.cues.length && !window.confirm('기존 자막을 자동 인식 결과로 교체할까요? 취소하면 기존 자막이 유지됩니다.')) return;
    const selected = clip.id;
    const sourceId = clip.source === 'youtube'
      ? linkedAsset?.sourceAssetId ?? (youtubeId ? 'youtube:' + youtubeId : null)
      : media?.id;
    if (!sourceId) return;
    setBusy(true);
    setSttBusy(true);
    setSttMessage('자동 자막 생성 준비 중…');
    setError('');
    try {
      await flushEdits();
      const result = await window.shortfab.transcribeClip({ sourceId, language: sttLanguage });
      if (result.status === 'cancelled') {
        setSttMessage('자동 자막 생성이 취소되었습니다. 기존 자막은 유지됩니다.');
      } else if (draftRef.current?.selectedClipId === selected) {
        changeDraft((current) => ({
          ...current,
          clips: current.clips.map((item) => item.id === selected ? {
            ...item, subtitles: result.track,
          } : item),
        }));
        setSttMessage(`자동 자막 ${result.track.cues.length}개 생성 완료. 내용을 검토하고 수정한 뒤 MP4로 출력하세요.`);
      }
    } catch (cause) {
      setSttMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSttBusy(false);
      setBusy(false);
    }
  }

  function addClipAtPlayhead() {
    if (!draft || sourceDuration === null || sourceTab !== 'youtube' || !youtubeId ||
        busy || rendering || draft.clips.length >= 100) return;
    const from = Math.max(0, Math.min(playhead, sourceDuration - MIN_CLIP_SECONDS));
    const end = Math.min(sourceDuration, from + 30);
    if (end - from < MIN_CLIP_SECONDS - CLIP_TIME_EPSILON) return;
    const id = crypto.randomUUID();
    changeDraft((current) => ({
      ...current, clips: [...current.clips, {
        source: 'youtube', id, title: `클립 ${current.clips.length + 1}`,
        start: Number(from.toFixed(2)), end: Number(end.toFixed(2)),
        width: clip?.width ?? 720, subtitles: null,
      }], selectedClipId: id,
    }));
  }

  function wizardGoTo(step: WizardStep) {
    changeDraft((current) => ({
      ...current, wizard: { ...normalizeWizard(current.wizard, current.clips), activeStep: step },
    }));
  }

  function wizardAccept(step: WizardStep, fields: WizardFields, skipped = false) {
    changeDraft((current) => {
      const existing = normalizeWizard(current.wizard, current.clips);
      const updated = skipped ? skipStep(existing, current.selectedClipId, step)
        : acceptStep(existing, current.selectedClipId, step, fields);
      const next = WIZARD_STEPS[WIZARD_STEPS.indexOf(step) + 1] ?? step;
      return { ...current, wizard: { ...updated, activeStep: next } };
    });
  }

  function addClip() {
    if (sourceDuration === null || !draft || busy || rendering ||
      (sourceTab === 'youtube' && !youtubeId) || (sourceTab === 'local' && !sourceConnected)) return;
    const from = clip && clip.end + 0.2 <= sourceDuration ? clip.end : clip?.start ?? 0;
    const to = Math.min(sourceDuration, from + 30);
    if (to - from < 0.2 || draft.clips.length >= 100) return;
    const newClip: ProjectClip = {
      source: sourceTab, id: crypto.randomUUID(), title: `클립 ${draft.clips.length + 1}`,
      start: from, end: to, width: clip?.width ?? 720, subtitles: null,
    };
    changeDraft((current) => ({
      ...current, clips: [...current.clips, newClip], selectedClipId: newClip.id,
    }));
    setPlayhead(from);
  }

  function removeClip() {
    if (!clip || busy || rendering) return;
    changeDraft((current) => {
      const remaining = current.clips.filter((item) => item.id !== current.selectedClipId);
      return {
        ...current, clips: remaining,
        selectedClipId: remaining[0]?.id ?? null,
      };
    });
  }

  function onPlaybackTime(time: number) {
    // A playing video keeps reporting its old position while the user drags.
    // Only the user's thumb position should control the timeline until release.
    if (!isScrubbing.current && Number.isFinite(time)) setPlayhead(time);
  }

  function moveTo(time: number) {
    if (sourceDuration === null) return;
    const clamped = Math.min(sourceDuration, Math.max(0, time));
    setPlayhead(clamped);
    if (sourceTab === 'youtube') youtubePlayer.current?.seek(clamped);
    else if (videoRef.current) videoRef.current.currentTime = clamped;
  }

  function updateScrub(time: number) {
    if (sourceDuration === null) return;
    const clamped = Math.min(sourceDuration, Math.max(0, time));
    if (isScrubbing.current) setScrubTime(clamped);
    else moveTo(clamped); // Keyboard and accessibility controls commit directly.
  }

  function finishScrub(time: number) {
    if (!isScrubbing.current) return;
    isScrubbing.current = false;
    setScrubTime(null);
    moveTo(time); // One seek on pointer release, not on every drag frame.
  }

  function toggleYouTubePlayback() {
    if (sourceTab !== 'youtube' || !youtubePlayer.current) return;
    if (playing) youtubePlayer.current.pause();
    else youtubePlayer.current.play();
  }

  async function playClip() {
    if (sourceTab === 'youtube') {
      if (!clip) return;
      youtubePlayer.current?.seek(clip.start);
      youtubePlayer.current?.play();
      return;
    }
    const video = videoRef.current;
    if (!video || !clip) return;
    video.currentTime = clip.start;
    try { await video.play(); }
    catch { setError('미리보기를 재생할 수 없습니다. 원본 코덱을 확인하세요.'); }
  }

  async function renderClip() {
    if (!canRender || !clip || !window.shortfab) return;
    const renderAssetId = clip.source === 'youtube'
      ? linkedAsset?.sourceAssetId ?? (youtubeId ? 'youtube:' + youtubeId : null) : media?.id;
    const offset = clip.source === 'youtube' ? linkedAsset?.startOffsetSeconds ?? 0 : 0;
    if (!renderAssetId) return;
    setError('');
    setRendering(true);
    setProgress({ percent: 0, seconds: 0 });
    setStatus('MP4 출력 위치를 선택해 주세요.');
    try {
      await flushEdits();
      const result = await window.shortfab.startRender({
        sourceId: renderAssetId, start: clip.start + offset, end: clip.end + offset, width: clip.width,
      });
      setStatus(result.status === 'completed' ? `완료: ${result.outputPath}` : '내보내기가 취소되었습니다.');
      if (result.status === 'completed') {
        await refreshPublishing();
        setPublishMessage('MP4가 준비되었습니다. YouTube 게시 설정을 확인해 주세요.');
        if (wizardMode) {
          changeDraft((current) => ({
            ...current, wizard: acceptStep(normalizeWizard(current.wizard, current.clips),
              current.selectedClipId, 'export', { completed: true }),
          }));
        } else setOutputTab('publish');
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message.includes('취소')) setStatus('렌더가 취소되었습니다.');
      else { setError(message); setStatus('렌더에 실패했습니다.'); }
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">S/</span><div><strong>ShortFab</strong><small>숏컷공장 · YouTube-first</small></div></div>
        <span className="stage-label">LOCAL FIRST · EXPORT + YOUTUBE</span>
      </header>

      <div className="project-bar">
        <label htmlFor="project-selector">프로젝트</label>
        <select id="project-selector" value={project?.id ?? ''} disabled={busy || rendering || !project}
          onChange={(event) => void openProject(event.target.value)}>
          {!project && <option value="">불러오는 중…</option>}
          {projects.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.clipCount} clips</option>)}
        </select>
        <button disabled={busy || rendering || !project} onClick={() => void newProject()}>+ 새 프로젝트</button>
        <span className="save-indicator" aria-live="polite">{dirty
          ? (draftValidationError ? '수정 필요 · 저장 대기' : '변경 중 · 자동 저장') : '저장됨'}</span>
      </div>

      <div className="creation-mode">
        <button type="button" className={wizardMode ? 'active' : ''}
          onClick={() => { setWizardMode(true); setSourceTab('youtube'); }}>단계별 제작</button>
        <button type="button" className={!wizardMode ? 'active' : ''}
          onClick={() => setWizardMode(false)}>고급 편집</button>
        <span>{wizardMode ? 'AI 추천 기능을 단계별로 추가 중 · 현재 지원 기능을 정확히 표시합니다.' : '기존 수동 타임라인 · 자막 · 게시 설정'}</span>
      </div>

      {wizardMode && <WizardProgress wizard={wizard} clipId={draft?.selectedClipId ?? null}
        disabled={busy || rendering} onGoTo={wizardGoTo} />}
      <div className={wizardMode ? 'workspace wizard-workspace' : 'workspace'}>
        {wizardMode && draft && <WizardPanel wizard={wizard} draft={draft}
          clip={clip ?? null} youtubeId={youtubeId} sourceDuration={draft.youtubeDuration}
          validClip={validClip} validationError={draftValidationError}
          ready={canRender} busy={busy} rendering={rendering} progress={progress}
          sttSetup={sttSetup} sttBusy={sttBusy} status={status} error={error}
          onUrl={setYoutubeUrl} onAddClip={addClipAtPlayhead}
          onSelectClip={(id, start) => {
            changeDraft((current) => ({ ...current, selectedClipId: id }));
            moveTo(start);
          }}
          onClip={updateClip} onGoTo={wizardGoTo} onAccept={wizardAccept}
          onAdvanced={() => setWizardMode(false)}
          onRender={() => void renderClip()}
          onCancelRender={() => void window.shortfab?.cancelRender()}
          onTranscribe={() => void generateSubtitles()}
          onInstallModel={() => void installSttModel()} />}

        <aside className="sidebar" hidden={wizardMode}>
          <p className="eyebrow">01 — PROJECT / SOURCE</p>
          <h2>영상 가져오기</h2>
          <label htmlFor="project-title">프로젝트 이름</label>
          <input id="project-title" value={draft?.title ?? ''} disabled={!draft || busy || rendering}
            onChange={(event) => changeDraft((current) => ({ ...current, title: event.target.value }))} />
          {dirty && draftValidationError &&
            <p className="warning" role="alert">저장 전 수정 필요: {draftValidationError}</p>}
          <div className="tab-group source-tabs">
            <button className={sourceTab === 'youtube' ? 'active' : ''} onClick={() => selectSource('youtube')}>YouTube 탐색</button>
            <button className={sourceTab === 'local' ? 'active' : ''} onClick={() => selectSource('local')}>로컬 원본</button>
          </div>
          {sourceTab === 'local' ? (
            <section className="pane">
              <button className="primary full" disabled={busy || rendering || !project} onClick={() => void chooseMedia(false)}>
                {media ? '다른 원본으로 교체 (클립 초기화)' : '영상 파일 선택'}
              </button>
              <p className="hint">MP4 · MOV · MKV · WEBM · M4V</p>
              {media && <div className="source-details">
                <strong>{media.name}</strong>
                <span>{media.width} × {media.height} · {formatTime(media.duration)}</span>
                <span>{media.hasAudio ? '오디오 포함' : '오디오 없음'}</span>
                <span>{sourceConnected ? '● 연결됨' : '● 원본을 찾을 수 없음'}</span>
              </div>}
              {project?.sourceStatus === 'missing' &&
                <button className="full secondary" disabled={busy || rendering} onClick={() => void chooseMedia(true)}>원본 파일 재연결</button>}
            </section>
          ) : (
            <section className="pane">
              <label htmlFor="youtube-url">YouTube URL</label>
              <input id="youtube-url" value={draft?.youtubeUrl ?? ''} disabled={!draft || busy || rendering}
                onChange={(event) => setYoutubeUrl(event.target.value)}
                placeholder="https://youtu.be/…" />
              <p className="hint">공식 플레이어에서 영상을 탐색하고 원하는 구간을 클립 후보로 저장하세요.</p>
              {youtubeId && <>
                <details className="source-info">
                  <summary>원본 정보 · 이용 안내</summary>
                  <div className="source-info-body">
                    <strong>{linkedAsset ? '연결된 원본' : '개인용 직접 MP4 출력'}</strong>
                    <span>{draft?.youtubeDuration ? `영상 길이 ${formatTime(draft.youtubeDuration)}` : '영상 메타데이터 로딩 중'}</span>
                    <span>{linkedAsset ? `원본: ${linkedAsset.fileName} · 오프셋 +${linkedAsset.startOffsetSeconds}초` :
                      'MP4 익스포트 시 공개 영상을 가져옵니다. 별도 원본 등록은 필요하지 않습니다.'}</span>
                    <span>개인 이용에도 원본 권리 및 YouTube 이용약관을 확인해 주세요. 접근 제한·DRM 영상은 지원하지 않습니다.</span>
                    <a href={`https://www.youtube.com/watch?v=${youtubeId}`} target="_blank" rel="noreferrer">YouTube에서 원본 보기 ↗</a>
                  </div>
                </details>
                <details className="source-binding source-advanced">
                  <summary>고급: 권리자·파트너 원본 연결</summary>
                  <div className="source-partner">
                    <strong>파트너 원본 자동 탐색</strong>
                    <p className="hint">현재 YouTube 영상 ID를 권리자 카탈로그에서 조회합니다. 검증된 서명·사용 권한이 있는 원본만 다운로드합니다.</p>
                    <button className="primary full"
                      disabled={!partnerConfigured || !draft?.youtubeDuration || busy || rendering || publishingBusy}
                      onClick={() => void discoverPartnerSource()}>
                      {partnerBusy ? '파트너 원본 검색·검증 중…' : partnerConfigured ?
                        'YouTube ID로 승인 원본 자동 찾기' : '파트너 카탈로그 연결 필요'}
                    </button>
                    {!partnerConfigured && <p className="hint">파트너 카탈로그 주소와 서명 공개키가 설정된 앱에서 활성화됩니다.</p>}
                    {partnerError && <p className="warning" role="alert">{partnerError}</p>}
                  </div>
                  <strong>허가받은 인코딩 원본 연결</strong>
                  <p className="hint">권리자가 제공한 영상 파일을 연결합니다. 파일은 로컬에 보관되며 같은 YouTube ID로 다시 찾을 수 있습니다.</p>
                  <label htmlFor="rights-holder">권리자 / 계약 상대방</label>
                  <input id="rights-holder" value={rightsForm.rightsHolder} disabled={busy || rendering}
                    placeholder="이름 또는 조직" onChange={e => setRightsForm(v => ({ ...v, rightsHolder: e.target.value }))} />
                  <label htmlFor="rights-evidence">이용 허가 증빙 참조</label>
                  <input id="rights-evidence" value={rightsForm.evidenceRef} disabled={busy || rendering}
                    placeholder="계약 번호, 승인 이메일 등" onChange={e => setRightsForm(v => ({ ...v, evidenceRef: e.target.value }))} />
                  <label htmlFor="rights-offset">영상 시작 오프셋 (초)</label>
                  <input id="rights-offset" type="number" min="0" max="86400" step="0.1"
                    value={rightsForm.startOffsetSeconds} disabled={busy || rendering}
                    onChange={e => setRightsForm(v => ({ ...v, startOffsetSeconds: Number(e.target.value) }))} />
                  <label htmlFor="rights-hash">권리자 제공 SHA-256 (선택)</label>
                  <input id="rights-hash" value={rightsForm.expectedSha256 ?? ''} disabled={busy || rendering}
                    placeholder="64자 체크섬" onChange={e => setRightsForm(v => ({ ...v, expectedSha256: e.target.value || null }))} />
                  <label htmlFor="rights-expiry">사용 허가 만료일 (선택)</label>
                  <input id="rights-expiry" type="date" value={rightsForm.expiresAt ?? ''} disabled={busy || rendering}
                    onChange={e => setRightsForm(v => ({ ...v, expiresAt: e.target.value || null }))} />
                  <label className="rights-checkbox"><input type="checkbox" checked={rightsForm.allowClip}
                    onChange={e => setRightsForm(v => ({ ...v, allowClip: e.target.checked }))} />클립 발췌 사용 허가를 받았습니다.</label>
                  <label className="rights-checkbox"><input type="checkbox" checked={rightsForm.allowDerivativeEdit}
                    onChange={e => setRightsForm(v => ({ ...v, allowDerivativeEdit: e.target.checked }))} />숏폼 변형·편집 허가를 받았습니다.</label>
                  <label className="rights-checkbox"><input type="checkbox" checked={rightsForm.allowRepost}
                    onChange={e => setRightsForm(v => ({ ...v, allowRepost: e.target.checked }))} />YouTube 재게시까지 허가를 받았습니다.</label>
                  <button className="secondary full" disabled={!draft?.youtubeDuration || busy || rendering || publishingBusy ||
                    !rightsForm.allowClip || !rightsForm.allowDerivativeEdit || !rightsForm.rightsHolder.trim() || !rightsForm.evidenceRef.trim()}
                    onClick={() => void bindAuthorizedSource()}>
                    {linkedAsset ? '연결된 원본 다시 선택' : '권리자 원본 파일 선택 및 연결'}
                  </button>
                  <div className="source-cloud">
                    <strong>승인된 클라우드 원본 가져오기</strong>
                    <p className="hint">앱 운영자가 등록한 HTTPS 미디어 호스트의 직접 파일 링크만 지원합니다. 이 링크는 로컬 프로젝트에 저장하지 않습니다.</p>
                    <label htmlFor="source-cloud-url">클라우드 원본 직접 링크</label>
                    <input id="source-cloud-url" type="url" value={cloudUrl} disabled={busy || rendering}
                      placeholder="https://media.example.com/asset.mp4?signature=..."
                      onChange={e => { setCloudUrl(e.target.value); setCloudError(''); }} />
                    <p className="hint">클라우드 연결 시 위 SHA-256 64자 체크섬은 필수입니다. 사용 권한과 증빙은 로컬 파일 연결과 동일하게 적용됩니다.</p>
                    <button className="secondary full" disabled={busy || rendering || publishingBusy ||
                      !draft?.youtubeDuration || !cloudUrl.trim() || !/^[a-f0-9]{64}$/i.test(rightsForm.expectedSha256 ?? '') ||
                      !rightsForm.allowClip || !rightsForm.allowDerivativeEdit ||
                      !rightsForm.rightsHolder.trim() || !rightsForm.evidenceRef.trim()}
                      onClick={() => void bindApprovedCloudSource()}>
                      {cloudBusy ? '원본 검사 및 가져오는 중…' : '클라우드 원본 다운로드·검증·연결'}
                    </button>
                    {cloudError && <p className="warning" role="alert">{cloudError}</p>}
                  </div>
                </details>
              </>}
              {draft?.youtubeUrl && !youtubeId && <p className="warning">올바른 YouTube 링크를 입력해 주세요.</p>}
            </section>
          )}

          <div className="section-rule" />
          <p className="eyebrow">02 — CLIP LIBRARY</p>
          <h2>클립 후보</h2>
          <div className="clip-choices">
            {visibleClips.map((item) => <button key={item.id}
              className={draft?.selectedClipId === item.id ? 'clip-choice selected' : 'clip-choice'}
              disabled={busy || rendering}
              onClick={() => { changeDraft((current) => ({ ...current, selectedClipId: item.id })); moveTo(item.start); }}>
              <strong>{item.title}</strong><small>{formatTime(item.start)}–{formatTime(item.end)}</small>
            </button>)}
            {!visibleClips.length && <p className="hint">{sourceTab === 'youtube' ? '영상 길이를 불러온 뒤 후보를 추가하세요.' : '원본을 연결하면 첫 클립이 생성됩니다.'}</p>}
          </div>
          <div className="clip-actions">
            <button disabled={sourceDuration === null || busy || rendering ||
              (sourceTab === 'local' && !sourceConnected) || (draft?.clips.length ?? 0) >= 100} onClick={addClip}>+ 후보 추가</button>
            <button disabled={!clip || busy || rendering} onClick={removeClip}>선택 삭제</button>
          </div>

          {clip && <>
            <label htmlFor="clip-title">클립 이름</label>
            <input id="clip-title" value={clip.title} disabled={busy || rendering}
              onChange={(event) => updateClip({ title: event.target.value })} />
            <div className="marker-grid clip-markers">
              <label>IN (초)<input type="number" min="0" step="0.1" value={clip.start} disabled={busy || rendering}
                onChange={(event) => updateClip({ start: Number(event.target.value) })} /></label>
              <label>OUT (초)<input type="number" min="0" step="0.1" value={clip.end} disabled={busy || rendering}
                onChange={(event) => updateClip({ end: Number(event.target.value) })} /></label>
            </div>
            <div className="marker-actions">
              <button disabled={sourceDuration === null || busy || rendering} onClick={() => updateClip({ start: Math.min(playhead, clip.end - 0.2) })}>현재 시각 → IN</button>
              <button disabled={sourceDuration === null || busy || rendering} onClick={() => updateClip({ end: Math.max(playhead, clip.start + 0.2) })}>현재 시각 → OUT</button>
            </div>
            <div className="duration"><span>선택 구간</span><strong>{formatTime(clip.end - clip.start)}</strong></div>
            <details className="caption-editor">
              <summary>자막 편집 · {clip.subtitles?.cues.length ?? 0}개</summary>
              <p className="hint">클립 IN을 0초로 하는 자막입니다. 로컬 음성 인식 또는 직접 입력 후 검토하고 MP4에 합성할 수 있습니다.</p>
              <div className="stt-controls">
                <label htmlFor="stt-language">음성 인식 언어</label>
                <select id="stt-language" value={sttLanguage} disabled={busy || rendering}
                  onChange={(event) => setSttLanguage(event.target.value as SttLanguage)}>
                  <option value="auto">자동 감지</option>
                  <option value="ko">한국어</option>
                  <option value="en">English</option>
                </select>
                <div className="stt-setup">
                  <span>{sttSetup?.engineAvailable ? '● whisper-cli 설치됨' : '○ whisper-cli 설치 필요'}</span>
                  <span>{sttSetup?.modelAvailable ? `● 모델: ${sttSetup.modelName}` : '○ GGML 모델(.bin) 선택 필요'}</span>
                </div>
                {!sttSetup?.modelAvailable && <button className="primary full" type="button"
                  disabled={busy || rendering || publishingBusy || sttBusy}
                  onClick={() => void installSttModel()}>
                  {modelInstalling ? '다국어 모델 다운로드 중…' : '기본 한국어·영어 모델 설치 (약 148MB)'}
                </button>}
                {modelInstalling && <button className="cancel full" type="button"
                  onClick={() => void window.shortfab?.cancelSttModel()}>모델 다운로드 취소</button>}
                <button className="secondary full" type="button" disabled={busy || rendering}
                  onClick={() => void chooseSttModel()}>다른 GGML 모델 파일 선택…</button>
                <button className="primary full" type="button"
                  disabled={!validClip || !!draftValidationError || busy || rendering ||
                    !sttSetup?.engineAvailable || !sttSetup.modelAvailable ||
                    clip.end - clip.start > MAX_STT_SECONDS}
                  onClick={() => void generateSubtitles()}>
                  {sttBusy ? '자동 자막 생성 중…' : clip.subtitles?.cues.length ? '자동 자막 다시 생성' : 'AI 자동 자막 생성'}
                </button>
                {sttBusy && <button className="cancel full" type="button"
                  onClick={() => void window.shortfab?.cancelTranscription()}>자동 자막 생성 취소</button>}
                {sttMessage && <p role="status" aria-live="polite" className="hint">{sttMessage}</p>}
                {(!sttSetup?.engineAvailable || !sttSetup.modelAvailable) &&
                  <p className="hint">로컬 준비: Mac <code>brew install whisper.cpp ffmpeg</code>.
                    기본 모델은 버튼으로 내려받거나 기존 GGML 다국어 모델(.bin)을 선택할 수 있습니다. 모델 다운로드 때만 외부 서버에 접속하며, 영상/음성은 외부로 전송하지 않습니다.</p>}
              </div>
              <label htmlFor="caption-preset">자막 스타일</label>
              <select id="caption-preset" value={clip.subtitles?.preset ?? 'classic'}
                disabled={busy || rendering} onChange={(event) => updateSubtitles((value) => ({
                  ...value, preset: event.target.value as SubtitleTrack['preset'],
                }))}>
                {SUBTITLE_PRESETS.map((preset) => <option key={preset} value={preset}>{{
                  classic: '기본 흰색', bold: '강조 노랑', minimal: '미니멀', boxed: '배경 박스',
                }[preset]}</option>)}
              </select>
              {(clip.subtitles?.cues ?? []).map((cue, index) => <div key={cue.id} className="caption-cue">
                <div className="caption-cue-head">
                  <strong>자막 {index + 1}</strong>
                  <div>
                    <button type="button" disabled={busy || rendering}
                      onClick={() => moveTo(clip.start + cue.start)}>▶ 위치</button>
                    <button type="button" disabled={busy || rendering}
                      onClick={() => removeCaption(cue.id)}>삭제</button>
                  </div>
                </div>
                <textarea aria-label={`자막 ${index + 1} 내용`} rows={2} maxLength={100}
                  value={cue.text} disabled={busy || rendering}
                  onChange={(event) => updateCaption(cue.id, { text: event.target.value })} />
                <div className="marker-grid">
                  <label>시작 (클립 초)<input type="number" min="0" step="0.1"
                    disabled={busy || rendering} value={cue.start}
                    onChange={(event) => updateCaption(cue.id, { start: Number(event.target.value) })} /></label>
                  <label>끝 (클립 초)<input type="number" min="0" step="0.1"
                    disabled={busy || rendering} value={cue.end}
                    onChange={(event) => updateCaption(cue.id, { end: Number(event.target.value) })} /></label>
                </div>
              </div>)}
              <button type="button" className="secondary full" disabled={busy || rendering || (clip.subtitles?.cues.length ?? 0) >= 30}
                onClick={addCaption}>+ 현재 위치에 자막 추가</button>
              <p className="hint">내용이 비었거나 시간이 겹치면 자동 저장·익스포트가 보류됩니다. 자동 인식 결과는 반드시 확인해 주세요.</p>
            </details>
            <button className="secondary full" disabled={!validClip || (sourceTab === 'local' && !sourceConnected) || busy || rendering}
              onClick={() => void playClip()}>▶ 선택 구간 재생</button>
            {sourceTab === 'youtube' && <label className="loop-option"><input type="checkbox" checked={loopClip}
              onChange={(event) => setLoopClip(event.target.checked)} /> 선택 구간 반복 재생</label>}
            {!validClip && <p className="warning">유효한 IN/OUT 구간을 지정해 주세요.</p>}
          </>}
          <div className="section-rule" />
          <p className="eyebrow">03 — OUTPUT</p>
          <h2>세로 화면</h2>
          <div className="resolution">
            {([720, 1080] as const).map((width) =>
              <button key={width} className={clip?.width === width ? 'selected' : ''}
                disabled={!clip || busy || rendering} onClick={() => updateClip({ width })}>
                {width}p <small>{width === 720 ? '빠른 테스트' : 'Full HD'}</small>
              </button>)}
          </div>
          <p className="hint">클립마다 해상도를 저장합니다. 중앙 크롭 · 9:16 · 30 fps</p>
        </aside>

        <main className="preview-area">
          <div className="preview-heading"><div><p className="eyebrow">{sourceTab === 'youtube' ? 'YOUTUBE SOURCE PLAYER' : 'CANVAS PREVIEW'}</p><h2>{sourceTab === 'youtube' ? (wizardMode ? '원본 영상 · 합성 출력 프리뷰 아님' : 'YouTube 원본 구간 탐색') : '출력 프레임 미리보기'}</h2></div><span>{sourceTab === 'youtube' ? 'YOUTUBE · CLIP' : '9:16'}</span></div>
          <div className="preview-stage">
            <div className="portrait">
              {sourceTab === 'youtube' && youtubeId ? (
                <YouTubePreview key={youtubeId} ref={youtubePlayer} videoId={youtubeId}
                  start={clip?.start ?? null} end={clip?.end ?? null} loop={loopClip}
                  onTime={onPlaybackTime} onPlaying={setPlaying} onDuration={onYoutubeDuration} />
              ) : media && sourceTab === 'local' && sourceConnected ? (
                <video key={`${project?.id}-${media.id}-${media.previewUrl}`} ref={videoRef}
                  src={media.previewUrl} controls playsInline preload="metadata"
                  onTimeUpdate={(event) => {
                    const current = event.currentTarget;
                    onPlaybackTime(current.currentTime);
                    if (!current.paused && clip && current.currentTime >= clip.end) current.pause();
                  }} />
              ) : (
                <div className="empty-preview"><span className="film-symbol">▣</span>
                  <strong>YOUR SHORT STARTS HERE</strong>
                  <small>{sourceTab === 'youtube' ? 'YouTube URL을 입력해 주세요' : project?.sourceStatus === 'missing' ? '원본을 재연결해 주세요' : '로컬 영상을 선택하세요'}</small>
                </div>
              )}
              {activeCaption && clip?.subtitles && <div aria-hidden="true"
                className={`subtitle-preview subtitle-${clip.subtitles.preset}`}>
                {activeCaption.text}
              </div>}
            </div>
          </div>
          <div className="timeline">
            <div className="timeline-top">
              <div className="timeline-leading">
                {sourceTab === 'youtube' && <button className="timeline-play" type="button"
                  disabled={sourceDuration === null} aria-label={playing ? '영상 일시정지' : '영상 재생'}
                  onClick={toggleYouTubePlayback}>{playing ? 'Ⅱ' : '▶'}</button>}
                <span>현재 재생 위치</span>
              </div>
              <strong className="timeline-clock">
                <span className="timeline-current">{formatTime(currentTime)}</span>
                <span className="timeline-clock-separator"> / </span>
                <span>{sourceDuration === null ? '--:--' : formatTime(sourceDuration)}</span>
              </strong>
            </div>
            <input aria-label="영상 재생 위치" type="range" min="0" max={Math.max(sourceDuration ?? 30, 0.2)} step="0.1"
              disabled={sourceDuration === null || (sourceTab === 'local' && !sourceConnected)} value={currentTime}
              onPointerDown={() => { isScrubbing.current = true; setScrubTime(currentTime); }}
              onPointerUp={(event) => finishScrub(Number(event.currentTarget.value))}
              onPointerCancel={(event) => finishScrub(Number(event.currentTarget.value))}
              onLostPointerCapture={(event) => finishScrub(Number(event.currentTarget.value))}
              onBlur={(event) => finishScrub(Number(event.currentTarget.value))}
              onChange={(event) => updateScrub(Number(event.currentTarget.value))} />
            <div className="timeline-markers">
              <span>IN {formatTime(clip?.start ?? 0)}</span><span>OUT {formatTime(clip?.end ?? 0)}</span>
            </div>
          </div>
        </main>

        <aside className="export-panel" aria-label="출력 및 게시 설정" hidden={wizardMode}>
          <div className="output-tabs" role="tablist" aria-label="출력 작업"
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next: OutputTab = event.key === 'ArrowLeft' || event.key === 'Home' ? 'export' : 'publish';
              setOutputTab(next);
              event.currentTarget.querySelector<HTMLButtonElement>(`#output-${next}-tab`)?.focus();
            }}>
            <button id="output-export-tab" role="tab" type="button"
              aria-selected={outputTab === 'export'} tabIndex={outputTab === 'export' ? 0 : -1} aria-controls="output-export-panel"
              className={outputTab === 'export' ? 'active' : ''}
              onClick={() => setOutputTab('export')}>MP4 익스포트</button>
            <button id="output-publish-tab" role="tab" type="button"
              aria-selected={outputTab === 'publish'} tabIndex={outputTab === 'publish' ? 0 : -1} aria-controls="output-publish-panel"
              className={outputTab === 'publish' ? 'active' : ''}
              onClick={() => setOutputTab('publish')}>YouTube 게시</button>
          </div>
          <section id="output-export-panel" role="tabpanel" aria-labelledby="output-export-tab"
            className="output-tab-content" hidden={outputTab !== 'export'}>
          <p className="eyebrow">04 — EXPORT</p>
          <h2>MP4 내보내기</h2>
          <div className="export-spec"><span>형식</span><strong>MP4</strong></div>
          <div className="export-spec"><span>선택 클립</span><strong>{clip?.title ?? '없음'}</strong></div>
          <div className="export-spec"><span>해상도</span><strong>{clip ? `${clip.width} × ${clip.width * 16 / 9}` : '—'}</strong></div>
          <div className="export-spec"><span>프레임</span><strong>30 FPS</strong></div>
          <div className="export-spec"><span>클립 길이</span><strong>{formatTime(clip ? clip.end - clip.start : 0)}</strong></div>
          <div className="export-spec"><span>자막</span><strong>{clip?.subtitles?.cues.length ? `${clip.subtitles.cues.length}개 · ${clip.subtitles.preset}` : "없음"}</strong></div>
          {sourceTab === 'youtube' && <p className="hint">{linkedAsset ?
            '연결된 원본으로 출력합니다.' :
            'MP4 버튼을 누르면 YouTube 공개 영상을 로컬로 가져온 뒤 선택 구간을 세로 영상으로 출력합니다.'}</p>}
          {sourceTab === 'youtube' && !linkedAsset && personalToolReady === false &&
            <p className="warning">다운로드 도구 미설치. Mac 터미널에서 <code>brew install yt-dlp ffmpeg</code> 실행 후 앱을 다시 시작하세요.
              <a href="https://github.com/yt-dlp/yt-dlp/wiki/Installation" target="_blank" rel="noreferrer"> 설치 안내 ↗</a>
            </p>}
          <button className="primary full export-button" disabled={!canRender} onClick={() => void renderClip()}>
            {rendering ? '렌더링 중…' : '선택 클립 MP4 익스포트'}
          </button>
          {rendering && <button className="cancel full" onClick={() => void window.shortfab?.cancelRender()}>렌더 취소</button>}
          <div className="progress-area"><div className="progress-head"><span>{progress.phase === 'download' ? '영상 다운로드' : progress.phase === 'render' ? 'MP4 인코딩' : '진행 상태'}</span><strong>{progress.percent}%</strong></div>
            <div className="progress-track"><div style={{ width: `${progress.percent}%` }} /></div></div>
          <p className="status" aria-live="polite">{status}</p>
          {error && <p role="alert" className="error">{error}</p>}
          </section>
          <section id="output-publish-panel" role="tabpanel" aria-labelledby="output-publish-tab"
            className="output-tab-content" hidden={outputTab !== 'publish'}>
          <p className="eyebrow">05 — PUBLISH · YOUTUBE</p>
          <h2>YouTube 업로드</h2>
          <p className="hint">MP4 익스포트와 YouTube 게시 승인은 별개입니다. 연결된 Google 계정으로 공식 API를 이용해 업로드합니다.</p>
          {clip?.source === 'youtube' && !linked?.canPublishYouTube &&
            <p className="warning">YouTube 재게시 권한 선언이 없거나 원본 검증에 실패하여 업로드할 수 없습니다.</p>}
          <div className="publish-account">
            <span>{publishing?.connected ? '● YouTube 연결됨' :
              publishing?.configured ? '○ 계정 연결 필요' : '○ Google OAuth 설정 필요'}</span>
            {publishing?.connected ?
              <button disabled={publishingBusy || rendering || busy} onClick={() =>
                void youtubeAction(() => window.shortfab!.disconnectYouTube(), '계정 연결이 해제되었습니다.')}>연결 해제</button> :
              <button disabled={!publishing?.configured || publishingBusy || rendering || busy} onClick={() =>
                void youtubeAction(() => window.shortfab!.connectYouTube(), 'YouTube 계정이 연결되었습니다.')}>Google로 연결</button>}
          </div>
          {!publishing?.configured && <p className="hint">개발 환경에 SHORTFAB_GOOGLE_CLIENT_ID를 설정해야 연결할 수 있습니다.</p>}
          <p className="hint">{publishReady ? `게시 준비: ${publishing?.artifact?.filename}` :
            '현재 선택한 클립을 먼저 MP4로 익스포트해야 게시할 수 있습니다.'}</p>
          <label htmlFor="publish-title">YouTube 제목</label>
          <input id="publish-title" maxLength={100} value={publishForm.title} disabled={publishingBusy || rendering}
            onChange={(event) => setPublishForm((current) => ({ ...current, title: event.target.value }))} />
          <label htmlFor="publish-description">설명</label>
          <textarea id="publish-description" rows={3} maxLength={5000} value={publishForm.description}
            disabled={publishingBusy || rendering}
            onChange={(event) => setPublishForm((current) => ({ ...current, description: event.target.value }))} />
          <label htmlFor="publish-privacy">공개 범위</label>
          <select id="publish-privacy" value={publishForm.privacyStatus} disabled={publishingBusy || rendering}
            onChange={(event) => setPublishForm((current) => ({ ...current, privacyStatus: event.target.value as YouTubePrivacy }))}>
            <option value="private">비공개 (기본값)</option>
            <option value="unlisted">일부 공개</option>
            <option value="public">전체 공개</option>
          </select>
          <label htmlFor="publish-kids">아동용 콘텐츠 여부 (필수)</label>
          <select id="publish-kids" value={publishForm.madeForKids === null ? '' : String(publishForm.madeForKids)}
            disabled={publishingBusy || rendering}
            onChange={(event) => setPublishForm((current) => ({
              ...current, madeForKids: event.target.value === '' ? null : event.target.value === 'true',
            }))}>
            <option value="">선택해 주세요</option>
            <option value="false">아동용 아님</option>
            <option value="true">아동용</option>
          </select>
          <button className="primary full publish-button" disabled={!canPublish}
            onClick={() => void youtubeAction(
              () => window.shortfab!.startPublish(publishForm as PublishDraft),
              '영상 파일이 전송되었습니다. YouTube 처리 상태를 확인해 주세요.')}>
            {publishingBusy ? 'YouTube 작업 중…' : '별도 승인 후 YouTube 업로드'}
          </button>
          {publishMessage && <p className="status" aria-live="polite">{publishMessage}</p>}
          {publishError && <p className="error" role="alert">{publishError}</p>}
          {projectJobs.length > 0 && <div className="publish-history">
            <strong>최근 게시 작업</strong>
            {projectJobs.map((job) => <div className="publish-job" key={job.id}>
              <span className="job-name">{job.metadata.title}</span>
              <small>{job.state} · {job.progress}% · {job.metadata.privacyStatus}</small>
              <p className="hint">{job.message}</p>
              {job.remoteUrl && <a href={job.remoteUrl} target="_blank" rel="noreferrer">YouTube 영상 보기 ↗</a>}
              <div className="publish-buttons">
                {(job.state === 'processing' || job.state === 'published' || job.state === 'action_required') &&
                  job.remoteUrl && <button disabled={publishingBusy || rendering}
                    onClick={() => void youtubeAction(
                      () => window.shortfab!.refreshPublish(job.id),
                      'YouTube 처리 상태를 확인했습니다.')}>상태 새로고침</button>}
                {job.state === 'failed' && <button disabled={publishingBusy || rendering}
                  onClick={() => void youtubeAction(
                    () => window.shortfab!.retryPublish(job.id),
                    '기존 업로드 세션을 재개했습니다.')}>이어서 업로드</button>}
              </div>
            </div>)}
          </div>}
          <div className="coming-next"><strong>게시 제한 및 수동 업로드</strong>
            <p>API 연결이 불가능하거나 상태 확인이 필요하면 출력한 MP4를 YouTube Studio에서 직접 업로드하세요. 처리 완료는 전체 공개를 보장하지 않습니다.</p></div>
          </section>
        </aside>
      </div>
    </div>
  );
}

export default App;
