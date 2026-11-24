import { useRef } from 'react';
import type React from 'react';

/**
 * Glisser vers le bas pour réduire ou fermer, comme les fiches d'iOS, de Google Maps ou d'Instagram.
 * L'élément suit le doigt ; lâché assez bas, ou d'un geste rapide, il part, sinon il revient en place.
 * Un mouvement de moins de 8 px reste un simple toucher.
 *
 * Renvoie [ref, handlers] — ref : l'élément qui bouge ; handlers : à poser sur la zone qu'on attrape (toute la fiche, ou le haut
 * d'une fenêtre dont le contenu défile). Cette zone doit avoir `touch-action: none`.
 */
export function useDragDown<T extends HTMLElement>(onDone: () => void, enabled = true) {
  const target = useRef<T | null>(null);
  const state = useRef<{ id: number; y0: number; t0: number; dy: number; on: boolean } | null>(null);
  const dragged = useRef(false);

  const down = (e: React.PointerEvent) => {
    if (!enabled || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    state.current = { id: e.pointerId, y0: e.clientY, t0: e.timeStamp, dy: 0, on: false };
    dragged.current = false;
  };

  const move = (e: React.PointerEvent) => {
    const s = state.current;
    const el = target.current;
    if (!s || s.id !== e.pointerId || !el) return;
    const dy = e.clientY - s.y0;
    if (!s.on) {
      if (Math.abs(dy) < 8) return;
      // Vers le haut : ce n'est pas un geste pour fermer.
      if (dy < 0) {
        state.current = null;
        return;
      }
      s.on = true;
      dragged.current = true;
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      el.style.transition = 'none';
    }
    s.dy = Math.max(0, dy);
    el.style.transform = `translateY(${s.dy}px)`;
  };

  const up = (e: React.PointerEvent) => {
    const s = state.current;
    const el = target.current;
    state.current = null;
    if (!s || !s.on || !el) return;
    const fast = s.dy > 24 && s.dy / Math.max(1, e.timeStamp - s.t0) > 0.5;
    const far = s.dy > Math.min(110, el.offsetHeight * 0.3);
    el.style.transition = 'transform 0.18s ease-out';
    if (e.type !== 'pointercancel' && (far || fast)) {
      el.style.transform = `translateY(${el.offsetHeight + 24}px)`;
      window.setTimeout(() => {
        onDone();
        // Si l'élément reste affiché (fenêtre rouverte aussitôt…), on le remet en place.
        requestAnimationFrame(() => {
          if (el.isConnected) {
            el.style.transition = '';
            el.style.transform = '';
          }
        });
      }, 160);
    } else {
      el.style.transform = '';
    }
  };

  // Après un glissé, le doigt levé n'est pas un toucher (sur une ligne de la fiche, par exemple).
  const clickCapture = (e: React.MouseEvent) => {
    if (dragged.current) {
      dragged.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const handlers = { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up, onClickCapture: clickCapture };
  return [target, handlers] as const;
}
