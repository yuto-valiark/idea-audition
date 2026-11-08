import { useDisplay } from '../store/display-store.ts';

const INVITE_TEXT = 'IDEA AUDITION に招待されました。このリンクから一緒に審査しよう！';

/**
 * 招待：いま開いている部屋のリンクを配る。
 * スマホなど共有シートがある端末では、そのまま LINE やメッセージに送れる。ない端末ではリンクをコピーする。
 */
export async function shareInvite(url: string = location.href): Promise<void> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void>; canShare?: (d: ShareData) => boolean };
  const data = { title: 'IDEA AUDITION', text: INVITE_TEXT, url };
  if (nav.share && (!nav.canShare || nav.canShare(data)) && matchMedia('(pointer: coarse)').matches) {
    try {
      await nav.share(data);
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return; // 共有シートを閉じただけ
    }
  }
  await copyInvite(url);
}

export async function copyInvite(url: string = location.href): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    useDisplay.getState().toast('招待リンクをコピーしました。LINE などに貼って送ってください');
    return true;
  } catch {
    useDisplay.getState().toast(`コピーできませんでした。このリンクを送ってください：${url}`, 'warn');
    return false;
  }
}

/** LINE で送る画面を開く（スマホは LINE アプリ、PC はブラウザの LINE） */
export function lineShareUrl(url: string = location.href) {
  return `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(INVITE_TEXT)}`;
}
