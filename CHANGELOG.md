# Changelog

## 0.0.1v

- Introduced `rn-intersection-observer` as a separate package based on the
  original
  [`react-native-intersection-observer`](https://github.com/zhbhun/react-native-intersection-observer).
- Added explicit attribution to the original package and clarified that this
  package is an improved version rather than a rewrite.
- Documented the main fix target: edge cases where `InView` items are removed
  dynamically from a list while scrolling, which in the original package can
  cause incorrect visibility updates and wrong items becoming disabled.
