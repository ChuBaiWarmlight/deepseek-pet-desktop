// PetStage：双缓冲视频舞台。
//
// WebView2 在给 <video> 直接换 src 时会先清空已解码画面，表现为桌宠瞬间透明/闪白。
// 这里常驻两个 <video>：前台继续播放旧动作，后台预加载新动作，拿到首帧后再交换，
// 因此换动画时不会出现空白帧；首帧就绪前由海报兜底。

import React, { useCallback, useEffect, useRef, useState } from "react";

interface PetStageProps {
  src: string;
  width: number;
  height: number;
  facing: -1 | 1;
  activeVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
  onFailure: (src: string) => void;
}

type SlotIndex = 0 | 1;

export function PetStage({ src, width, height, facing, activeVideoRef, onFailure }: PetStageProps) {
  const [slots, setSlots] = useState<[string | null, string | null]>(() => [src, null]);
  const [front, setFront] = useState<SlotIndex>(0);
  const [posterVisible, setPosterVisible] = useState(true);
  const videos = useRef<[HTMLVideoElement | null, HTMLVideoElement | null]>([null, null]);
  const frontRef = useRef<SlotIndex>(0);
  const slotsRef = useRef(slots);
  const targetRef = useRef(src);
  slotsRef.current = slots;

  const tryPlay = useCallback((video: HTMLVideoElement) => {
    video.muted = true;
    video.defaultMuted = true;
    const p = video.play() as unknown as Promise<void> | undefined;
    if (p && typeof p.catch === "function") p.catch(() => {});
  }, []);

  const promote = useCallback(
    (index: SlotIndex, slotSrc: string) => {
      if (slotSrc !== targetRef.current) return;
      const video = videos.current[index];
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;
      frontRef.current = index;
      setFront(index);
      activeVideoRef.current = video;
      setPosterVisible(false);
      tryPlay(video);
    },
    [activeVideoRef, tryPlay],
  );

  const schedulePromote = useCallback(
    (index: SlotIndex, slotSrc: string) => {
      let promoted = false;
      const promoteOnce = () => {
        if (promoted) return;
        promoted = true;
        promote(index, slotSrc);
      };
      const video = videos.current[index];
      // requestVideoFrameCallback 能保证新画面已经解码；旧 WebView2 回退到短延迟。
      const withFrameCallback = video as
        | (HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number })
        | null;
      if (withFrameCallback && typeof withFrameCallback.requestVideoFrameCallback === "function") {
        withFrameCallback.requestVideoFrameCallback(promoteOnce);
      }
      setTimeout(promoteOnce, 90);
    },
    [promote],
  );

  // 新动画先装进后台槽位；前台旧动画保持可见，直到新视频真正出帧。
  useEffect(() => {
    targetRef.current = src;
    const current = slotsRef.current[frontRef.current];
    if (src === current) {
      const active = videos.current[frontRef.current];
      if (active) tryPlay(active);
      return;
    }
    const back: SlotIndex = frontRef.current === 0 ? 1 : 0;
    const backVideo = videos.current[back];
    // 后台槽位可能早就缓存过同一个动作（例如待机循环）。此时直接播放并切前台，
    // 不能只比较 state，否则不会触发任何加载事件，看门狗会误判为加载失败。
    if (slotsRef.current[back] === src && backVideo) {
      if (backVideo.error) backVideo.load();
      tryPlay(backVideo);
      schedulePromote(back, src);
      return;
    }
    setSlots((prev) => {
      if (prev[back] === src) return prev;
      const next: [string | null, string | null] = [prev[0], prev[1]];
      next[back] = src;
      return next;
    });
  }, [schedulePromote, src, tryPlay]);

  // 前台切换完成后暂停旧槽位，避免两个视频长期同时解码（降低 GPU 占用和抖动）。
  useEffect(() => {
    const otherIndex: SlotIndex = front === 0 ? 1 : 0;
    const other = videos.current[otherIndex];
    const otherSrc = slotsRef.current[otherIndex];
    if (other && otherSrc && otherSrc !== targetRef.current) other.pause();
  }, [front]);

  const handleReady = useCallback(
    (index: SlotIndex) => {
      const video = videos.current[index];
      if (!video) return;
      tryPlay(video);
      const slotSrc = slotsRef.current[index];
      if (!slotSrc || slotSrc !== targetRef.current) return;
      if (index === frontRef.current) {
        activeVideoRef.current = video;
        setPosterVisible(false);
        return;
      }
      schedulePromote(index, slotSrc);
    },
    [activeVideoRef, schedulePromote, tryPlay],
  );

  const handlePlaying = useCallback(
    (index: SlotIndex) => {
      const slotSrc = slotsRef.current[index];
      if (!slotSrc || slotSrc !== targetRef.current) return;
      if (index === frontRef.current) {
        activeVideoRef.current = videos.current[index];
        setPosterVisible(false);
        return;
      }
      handleReady(index);
    },
    [activeVideoRef, handleReady],
  );

  const handleFailure = useCallback(
    (index: SlotIndex) => {
      const slotSrc = slotsRef.current[index];
      if (!slotSrc) return;
      // 只处理当前目标：后台槽位里被淘汰的旧请求不应触发全局回退。
      if (slotSrc === targetRef.current) onFailure(slotSrc);
    },
    [onFailure],
  );

  // 自定义协议/编码异常偶尔不触发 onError，目标视频 7 秒仍无画面就主动回退。
  useEffect(() => {
    const timer = setTimeout(() => {
      const index = frontRef.current;
      const video = videos.current[index];
      const slotSrc = slotsRef.current[index];
      if (slotSrc === src && video && video.readyState >= 2 && !video.paused) return;
      if (targetRef.current === src) onFailure(src);
    }, 7_000);
    return () => clearTimeout(timer);
  }, [src, onFailure]);

  return (
    <div className="dsh-vpet-stage" style={{ width, height }}>
      <img
        className="dsh-vpet-poster"
        src="/pet-poster.png"
        alt=""
        style={{ opacity: posterVisible ? 1 : 0 }}
      />
      {slots.map((slotSrc, index) =>
        slotSrc ? (
          <video
            key={index}
            ref={(el) => {
              videos.current[index as SlotIndex] = el;
            }}
            className={"dsh-vpet-video" + (index === front ? " dsh-vpet-video-front" : "")}
            src={slotSrc}
            autoPlay
            preload="auto"
            loop
            muted
            playsInline
            onLoadedMetadata={(e) => tryPlay(e.currentTarget)}
            onLoadedData={() => handleReady(index as SlotIndex)}
            onCanPlay={() => handleReady(index as SlotIndex)}
            onPlaying={() => handlePlaying(index as SlotIndex)}
            onError={() => handleFailure(index as SlotIndex)}
            style={{
              width,
              height,
              transform: `scaleX(${facing})`,
              opacity: index === front ? 1 : 0,
              zIndex: index === front ? 2 : 1,
            }}
          />
        ) : null,
      )}
    </div>
  );
}
