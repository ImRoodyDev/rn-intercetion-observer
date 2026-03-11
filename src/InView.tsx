import React, {
  ComponentType,
  ReactElement,
  ReactNode,
  RefObject,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { LayoutChangeEvent, View, ViewProps } from 'react-native';

import IOContext, { TrackedElement } from './IOContext';

export interface RenderProps {
  inView: boolean;
  onChange: (inView: boolean) => void;
}

export interface Props {
  [key: string]: any;
}

export type InViewProps<T = Props> = T & {
  /**
   * Render the wrapping element as this element.
   * @default `View`
   */
  as?: ComponentType<any>;
  children: ReactNode | ((fields: RenderProps) => ReactElement<View>);
  /** Only trigger the inView callback once */
  triggerOnce?: boolean;
  /** Call this function whenever the in view state changes */
  onChange?: (inView: boolean) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
};

export type InViewWrapper = ComponentType<{
  ref?: RefObject<any> | ((ref: any) => void);
  onLayout?: (event: LayoutChangeEvent) => void;
}>;

/** Imperative methods exposed via ref on InView. */
export interface InViewHandle {
  measureInWindow: (...args: any[]) => void;
  measureLayout: (...args: any[]) => void;
  setNativeProps: (...args: any[]) => void;
  focus: (...args: any[]) => void;
  blur: (...args: any[]) => void;
}

function InViewComponent(props: InViewProps, ref: React.Ref<InViewHandle>) {
  const { as: ViewComponent = View, children, ...viewProps } = props;

  const context = useContext(IOContext);
  const viewRef = useRef<any>(null);
  const mountedRef = useRef(false);

  // Keep latest props & context accessible from stable callbacks
  const propsRef = useRef(props);
  const contextRef = useRef(context);
  propsRef.current = props;
  contextRef.current = context;

  // Tracked element — identity-stable, created once via lazy ref init.
  // Callback and measureLayout read from refs at call time so they
  // always reflect the latest values without needing to be recreated.
  const elementRef = useRef<TrackedElement>(null!);
  if (!elementRef.current) {
    elementRef.current = {
      inView: false,
      layout: null,
      measureLayout: (
        relativeToNode: any,
        onSuccess: (x: number, y: number, w: number, h: number) => void,
        onError?: () => void
      ) => {
        if (!viewRef.current?.measureLayout) {
          onError?.();
          return;
        }
        viewRef.current.measureLayout(relativeToNode, onSuccess, onError);
      },
      callback: (inView: boolean) => {
        if (!mountedRef.current) return;
        const { triggerOnce, onChange } = propsRef.current;
        if (inView && triggerOnce) {
          // onDestroy: unregister triggers recalculation of remaining elements
          contextRef.current?.manager?.unobserve(elementRef.current);
        }
        onChange?.(inView);
      },
    };
  }

  // Observe on mount, onDestroy on unmount
  useEffect(() => {
    mountedRef.current = true;
    context?.manager?.observe(elementRef.current);
    return () => {
      mountedRef.current = false;
      // onDestroy — removes element and triggers recalculation
      // based on the current scroll position
      context?.manager?.unobserve(elementRef.current);
    };
  }, [context?.manager]);

  // Expose imperative methods for ref consumers
  useImperativeHandle(
    ref,
    () => ({
      measureInWindow: (...args: any[]) =>
        viewRef.current?.measureInWindow(...args),
      measureLayout: (...args: any[]) =>
        viewRef.current?.measureLayout(...args),
      setNativeProps: (...args: any[]) =>
        viewRef.current?.setNativeProps(...args),
      focus: (...args: any[]) => viewRef.current?.focus(...args),
      blur: (...args: any[]) => viewRef.current?.blur(...args),
    }),
    []
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    elementRef.current.onLayout?.();
    propsRef.current.onLayout?.(event);
  }, []);

  if (typeof children === 'function') {
    return null;
  }

  const Wrapper: InViewWrapper = (ViewComponent || View) as InViewWrapper;
  return (
    <Wrapper {...viewProps} ref={viewRef} onLayout={handleLayout}>
      {children}
    </Wrapper>
  );
}

const InView = React.memo(React.forwardRef(InViewComponent));
InView.displayName = 'InView';

export default InView as React.MemoExoticComponent<
  React.ForwardRefExoticComponent<
    InViewProps & React.RefAttributes<InViewHandle>
  >
>;
