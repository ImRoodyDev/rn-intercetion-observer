import { InView, IOFlatList, IOScrollView, withIO } from '../src';

it('exports the public package API', () => {
  expect(InView).toBeDefined();
  expect(IOFlatList).toBeDefined();
  expect(IOScrollView).toBeDefined();
  expect(typeof withIO).toBe('function');
});
