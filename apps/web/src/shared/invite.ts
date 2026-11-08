import { useDisplay } from '../store/display-store.ts';

const INVITE_TEXT = 'IDEA AUDITION に招待されました。このリンクから一緒に審査しよう！';

/**
 * 招待：いま開いている部屋のリンクを配る。
 * 端末の共有シート（AirDrop・LINE・メッセージ・メールなど、端末にあるもの）を開く。共有シートがない環境ではリンクをコピーする。
 */
export async function shareInvite(url: string = location.href): Promise<void> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void>; canShare?: (d: ShareData) => boolean };
  const data = { title: 'IDEA AUDITION', text: INVITE_TEXT, url };
  if (nav.share && (!nav.canShare || nav.canShare(data))) {
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
    useDisplay.getState().toast('招待リンクをコピーしました');
    return true;
  } catch {
    useDisplay.getState().toast(`コピーできませんでした。このリンクを送ってください：${url}`, 'warn');
    return false;
  }
}
