import { createContext } from 'react';
import { LayoutRectangle } from 'react-native';

/** A tracked element registered with the scroll manager. */
export interface TrackedElement {
  /** Whether the element is currently intersecting the viewport. */
  inView: boolean;
  /** Cached layout relative to the scroll view. Null means "needs remeasure". */
  layout: LayoutRectangle | null;
  /** Measures the element's layout relative to a given ancestor node. */
  measureLayout: (
    node: any,
    callback: (x: number, y: number, width: number, height: number) => void,
    errorCallback?: () => void
  ) => void;
  /** Visibility change callback — fired when inView state changes. */
  callback: (inView: boolean) => void;
  /** Set by the manager on observe — triggers remeasurement of all elements. */
  onLayout?: () => void;
}

/** Manager interface exposed through context to InView children. */
export interface IOManagerInterface {
  observe(element: TrackedElement): void;
  unobserve(element: TrackedElement): void;
}

export interface IOContextValue {
  manager: IOManagerInterface | null;
}

const IOContext = createContext<IOContextValue>({
  manager: null,
});

export default IOContext;
