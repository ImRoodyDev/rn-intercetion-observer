import React, { type ComponentProps, useImperativeHandle } from 'react';
import { ScrollView } from 'react-native';

import IOContext from './IOContext';
import { useIOManager } from './useIOManager';

export type { RootMargin } from './useIOManager';

export interface IOComponentProps {
  rootMargin?: import('./useIOManager').RootMargin;
}

type WithIOProps = Pick<
  ComponentProps<typeof ScrollView>,
  | 'horizontal'
  | 'scrollEventThrottle'
  | 'onContentSizeChange'
  | 'onLayout'
  | 'onScroll'
>;

function withIO<CompProps extends WithIOProps>(
  Comp: new (props: CompProps) => any,
  methods: string[]
) {
  type ScrollableComponentProps = CompProps & IOComponentProps;

  const IOScrollableComponent = React.forwardRef<any, ScrollableComponentProps>(
    (props, ref) => {
      const {
        scrollerRef,
        contextValue,
        handleContentSizeChange,
        handleLayout,
        handleScroll,
      } = useIOManager({
        horizontal: props.horizontal ?? undefined,
        rootMargin: props.rootMargin,
        onContentSizeChange: props.onContentSizeChange,
        onLayout: props.onLayout,
        onScroll: props.onScroll,
      });

      useImperativeHandle(
        ref,
        () => {
          const handle: any = {};
          methods.forEach((method) => {
            handle[method] = (...args: any[]) =>
              scrollerRef.current?.[method]?.(...args);
          });
          return handle;
        },
        []
      );

      return (
        <IOContext.Provider value={contextValue}>
          <Comp
            scrollEventThrottle={16}
            {...(props as any)}
            ref={scrollerRef}
            onContentSizeChange={handleContentSizeChange}
            onLayout={handleLayout}
            onScroll={handleScroll}
          />
        </IOContext.Provider>
      );
    }
  );

  IOScrollableComponent.displayName = `withIO(${
    (Comp as any).displayName || Comp.name || 'Component'
  })`;

  return IOScrollableComponent as unknown as typeof Comp;
}

export default withIO;
