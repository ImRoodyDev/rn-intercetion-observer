import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import throttle from 'lodash/throttle';

import { IOContextValue, TrackedElement } from './IOContext';

// ── Types ────────────────────────────────────────────────────────────────

export interface RootMargin {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

export interface UseIOManagerOptions {
  horizontal?: boolean;
  rootMargin?: RootMargin;
  onContentSizeChange?: (width: number, height: number) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

export interface UseIOManagerReturn {
  scrollerRef: React.MutableRefObject<any>;
  contextValue: IOContextValue;
  handleContentSizeChange: (width: number, height: number) => void;
  handleLayout: (event: LayoutChangeEvent) => void;
  handleScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────

const defaultRootMargin: RootMargin = {
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
};

export function useIOManager(options: UseIOManagerOptions): UseIOManagerReturn {
  const scrollerRef = useRef<any>(null);
  const nodeRef = useRef<any>(null);
  const remeasureRetryCountRef = useRef(0);
  const remeasureAllElementsRef = useRef<() => void>(() => undefined);

  // ── Manager state (all in refs for identity stability) ───────────────

  /** Vector of all observed InView elements. */
  const elementsRef = useRef<TrackedElement[]>([]);

  /**
   * Monotonically increasing counter. Incremented every time
   * remeasureAllElements() starts a new batch. Bridge callbacks from
   * superseded batches discard themselves.
   */
  const genRef = useRef(0);

  const rafRef = useRef<number | null>(null);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const MAX_REMEASURE_RETRIES = 3;

  /**
   * True when cached layouts may be stale (e.g. after an unobserve
   * caused remaining elements to shift). processScroll() skips while
   * dirty; the pending remeasure clears the flag after refreshing.
   */
  const dirtyRef = useRef(false);

  /** Current scroll / layout state. */
  const scrollStateRef = useRef<NativeScrollEvent>({
    contentInset: { top: 0, right: 0, bottom: 0, left: 0 },
    contentOffset: { x: 0, y: 0 },
    contentSize: { width: 0, height: 0 },
    layoutMeasurement: { width: 0, height: 0 },
    zoomScale: 1,
  });

  // Keep latest options accessible from stable callbacks
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const resolveRootNode = useCallback(() => {
    const scroller = scrollerRef.current;
    const scrollResponder = scroller?.getScrollResponder?.();
    const nativeScrollRef =
      scroller?.getNativeScrollRef?.() ||
      scrollResponder?.getNativeScrollRef?.() ||
      scroller?.getScrollRef?.();

    return (
      nativeScrollRef?.getInnerViewRef?.() ||
      scroller?.getInnerViewRef?.() ||
      scrollResponder?.getInnerViewRef?.() ||
      nativeScrollRef ||
      null
    );
  }, []);

  const refreshRootNode = useCallback(() => {
    nodeRef.current = resolveRootNode();
    return nodeRef.current;
  }, [resolveRootNode]);

  const invalidateLayouts = useCallback(() => {
    dirtyRef.current = true;

    const elements = elementsRef.current;
    for (let i = 0; i < elements.length; i += 1) {
      elements[i].layout = null;
    }
  }, []);

  const scheduleRemeasure = useCallback(() => {
    if (rafRef.current !== null) {
      return;
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (elementsRef.current.length > 0) {
        remeasureAllElementsRef.current();
      } else {
        dirtyRef.current = false;
        remeasureRetryCountRef.current = 0;
      }
    });
  }, []);

  // ── Visibility calculation ───────────────────────────────────────────

  /**
   * Core visibility check — iterates the element vector and fires
   * callbacks for any element whose inView state changed.
   */
  const processScroll = useCallback(() => {
    const dirty = dirtyRef.current;
    const rootMargin = optionsRef.current.rootMargin || defaultRootMargin;
    const { contentOffset, contentSize, layoutMeasurement } =
      scrollStateRef.current;
    const horizontal = !!optionsRef.current.horizontal;

    if (
      contentSize.width <= 0 ||
      contentSize.height <= 0 ||
      layoutMeasurement.width <= 0 ||
      layoutMeasurement.height <= 0
    ) {
      return;
    }

    const contentOffsetWithLayout = horizontal
      ? contentOffset.x + layoutMeasurement.width
      : contentOffset.y + layoutMeasurement.height;

    const elements = elementsRef.current;
    let hasPendingLayouts = false;
    for (let i = 0; i < elements.length; i += 1) {
      const element = elements[i];
      const { layout } = element;

      if (!layout || layout.width === 0 || layout.height === 0) {
        hasPendingLayouts = true;
        continue;
      }

      let isIntersecting = false;
      if (horizontal) {
        isIntersecting =
          contentOffsetWithLayout + (rootMargin.right || 0) >= layout.x &&
          contentOffset.x - (rootMargin.left || 0) <= layout.x + layout.width;
      } else {
        isIntersecting =
          contentOffsetWithLayout + (rootMargin.bottom || 0) >= layout.y &&
          contentOffset.y - (rootMargin.top || 0) <= layout.y + layout.height;
      }

      if (element.inView !== isIntersecting) {
        // While layouts are stale (dirty), only allow hidden → visible
        // transitions. Never hide a currently-visible element based on
        // stale position data — this prevents the "empty list" symptom.
        if (dirty && !isIntersecting) continue;

        element.inView = isIntersecting;
        element.callback(isIntersecting);
      }
    }

    if (hasPendingLayouts && elements.length > 0) {
      scheduleRemeasure();
    }
  }, [scheduleRemeasure]);

  // ── Remeasure ────────────────────────────────────────────────────────

  /**
   * Remeasure all observed elements in a single batched round.
   * - Snapshots the vector so mid-flight unobserve() calls don't
   *   corrupt the iteration.
   * - Uses a generation counter to discard stale bridge callbacks.
   * - Calls processScroll() exactly once after ALL measurements land.
   */
  const remeasureAllElements = useCallback(() => {
    const generation = ++genRef.current;
    let failedMeasurements = 0;
    let finished = false;

    // Clear any previous safety timer
    if (safetyTimerRef.current !== null) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }

    const snapshot = elementsRef.current.slice();
    let remaining = snapshot.length;

    for (let i = 0; i < snapshot.length; i += 1) {
      snapshot[i].layout = null;
    }

    if (remaining === 0) {
      dirtyRef.current = false;
      remeasureRetryCountRef.current = 0;
      processScroll();
      return;
    }

    const rootNode = refreshRootNode();
    if (!rootNode) {
      scheduleRemeasure();
      return;
    }

    const finalizeBatch = () => {
      if (finished || generation !== genRef.current) {
        return;
      }

      finished = true;
      if (safetyTimerRef.current !== null) {
        clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }

      if (
        failedMeasurements > 0 &&
        elementsRef.current.length > 0 &&
        remeasureRetryCountRef.current < MAX_REMEASURE_RETRIES
      ) {
        remeasureRetryCountRef.current += 1;
        processScroll();
        scheduleRemeasure();
        return;
      }

      if (
        failedMeasurements === snapshot.length &&
        elementsRef.current.length > 0
      ) {
        // If a full batch failed, keep dirty mode enabled so stale hidden
        // transitions stay suppressed. Subsequent scroll/layout activity will
        // re-schedule measurement instead of leaving the manager stuck.
        dirtyRef.current = true;
        processScroll();
        return;
      }

      dirtyRef.current = false;
      remeasureRetryCountRef.current = 0;
      processScroll();
    };

    // Safety timeout: if some measureLayout callbacks never fire
    // (e.g. transient native timing), retry before trusting stale data.
    safetyTimerRef.current = setTimeout(() => {
      safetyTimerRef.current = null;
      if (generation === genRef.current && !finished) {
        failedMeasurements += remaining;
        finalizeBatch();
      }
    }, 200);

    /** Called after each element settles (success or failure). */
    const settle = () => {
      remaining -= 1;
      if (remaining === 0) {
        finalizeBatch();
      }
    };

    for (let i = 0; i < snapshot.length; i += 1) {
      const element = snapshot[i];
      try {
        element.measureLayout(
          rootNode,
          (x: number, y: number, width: number, height: number) => {
            if (generation === genRef.current) {
              if (elementsRef.current.indexOf(element) >= 0) {
                element.layout = { x, y, width, height };
              }
            }
            settle();
          },
          () => {
            // Measurement failed (e.g. node unmounted) — still settle
            if (
              generation === genRef.current &&
              elementsRef.current.indexOf(element) >= 0
            ) {
              element.layout = null;
              failedMeasurements += 1;
            }
            settle();
          }
        );
      } catch (_) {
        if (
          generation === genRef.current &&
          elementsRef.current.indexOf(element) >= 0
        ) {
          element.layout = null;
          failedMeasurements += 1;
        }
        settle();
      }
    }
  }, [processScroll, refreshRootNode, scheduleRemeasure]);

  remeasureAllElementsRef.current = remeasureAllElements;

  // ── Throttled wrappers (created once via lazy ref init) ──────────────

  const throttledProcessScrollRef = useRef<ReturnType<typeof throttle>>(null!);
  if (!throttledProcessScrollRef.current) {
    throttledProcessScrollRef.current = throttle(processScroll, 32, {
      leading: true,
      trailing: true,
    });
  }

  const throttledRemeasureRef = useRef<ReturnType<typeof throttle>>(null!);
  if (!throttledRemeasureRef.current) {
    throttledRemeasureRef.current = throttle(remeasureAllElements, 100, {
      leading: true,
      trailing: true,
    });
  }

  // ── Observe / Unobserve ──────────────────────────────────────────────

  /** Register an InView element in the tracking vector. */
  const observeElement = useCallback(
    (element: TrackedElement) => {
      if (elementsRef.current.indexOf(element) < 0) {
        element.layout = null;
        element.onLayout = throttledRemeasureRef.current;
        elementsRef.current.push(element);
        invalidateLayouts();
        throttledRemeasureRef.current();
      }
    },
    [invalidateLayouts]
  );

  /**
   * Remove an element from the tracking vector and trigger a
   * batched recalculation of remaining elements.
   *
   * Uses a coalescing (non-cancelling) RAF: the first removal in a
   * synchronous batch schedules one animation frame; subsequent
   * removals in the same frame are no-ops. By the time the RAF fires
   * all pending splices have completed, producing a single remeasure.
   */
  const unobserveElement = useCallback(
    (element: TrackedElement) => {
      const elements = elementsRef.current;
      const idx = elements.indexOf(element);
      if (idx >= 0) {
        element.onLayout = undefined;
        elements.splice(idx, 1);

        // Run processScroll immediately BEFORE marking dirty. Right
        // now the remaining elements haven't shifted yet in native
        // layout, so their cached positions are still correct for
        // this frame. This keeps visibility accurate until the
        // deferred remeasure refreshes positions after layout commits.
        processScroll();

        if (elements.length > 0) {
          // The remaining layouts are no longer trustworthy once the
          // removal commits, so drop them immediately instead of
          // letting scroll events keep consulting stale coordinates.
          invalidateLayouts();
          scheduleRemeasure();
        } else {
          // All elements removed — cancel any pending remeasure and clear dirty
          dirtyRef.current = false;
          remeasureRetryCountRef.current = 0;
          if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
          }
        }
      }
    },
    [invalidateLayouts, processScroll, scheduleRemeasure]
  );

  // ── Context value (stable — manager methods are stable) ──────────────

  const contextValue = useMemo<IOContextValue>(
    () => ({
      manager: {
        observe: observeElement,
        unobserve: unobserveElement,
      },
    }),
    [observeElement, unobserveElement]
  );

  // ── Mount: capture native scroll node ────────────────────────────────

  useEffect(() => {
    refreshRootNode();
  }, [refreshRootNode]);

  // ── Cleanup on unmount ───────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (safetyTimerRef.current !== null) clearTimeout(safetyTimerRef.current);
      throttledProcessScrollRef.current?.cancel();
      throttledRemeasureRef.current?.cancel();
    };
  }, []);

  // ── Scroll view event handlers ───────────────────────────────────────

  const handleContentSizeChange = useCallback(
    (width: number, height: number) => {
      const { contentSize } = scrollStateRef.current;
      if (width !== contentSize.width || height !== contentSize.height) {
        scrollStateRef.current.contentSize = { width, height };
        if (width > 0 && height > 0 && elementsRef.current.length > 0) {
          invalidateLayouts();
          throttledRemeasureRef.current();
        }
      }
      optionsRef.current.onContentSizeChange?.(width, height);
    },
    [invalidateLayouts]
  );

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const {
        nativeEvent: { layout },
      } = event;
      refreshRootNode();

      const { layoutMeasurement } = scrollStateRef.current;
      if (
        layoutMeasurement.width !== layout.width ||
        layoutMeasurement.height !== layout.height
      ) {
        scrollStateRef.current.layoutMeasurement = layout;
      }

      if (elementsRef.current.length > 0) {
        invalidateLayouts();
        throttledRemeasureRef.current();
      }

      optionsRef.current.onLayout?.(event);
    },
    [invalidateLayouts, refreshRootNode]
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollStateRef.current = event.nativeEvent;
      throttledProcessScrollRef.current();
      optionsRef.current.onScroll?.(event);
    },
    []
  );

  return {
    scrollerRef,
    contextValue,
    handleContentSizeChange,
    handleLayout,
    handleScroll,
  };
}
