import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { InView, IOFlatList, type IOFlatListController } from '../src';

/**
 * Test component that replicates the bug where removing InView items from
 * a scrolling list causes remaining visible items to incorrectly report
 * as hidden (stale cached layouts after content reflow).
 *
 * How to reproduce the original bug:
 *   1. Scroll down so several items are visible.
 *   2. Tap "Remove every other" or "Remove first 5" while scrolling.
 *   3. Without the fix, remaining items flash red (inView → false) even
 *      though they are still on screen.
 *
 * After the fix, items that remain in the viewport stay green.
 */

interface ItemData {
  id: number;
  title: string;
}

function generateItems(count: number): ItemData[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    title: `Item ${i + 1}`,
  }));
}

const INITIAL_COUNT = 30;

const Item = React.memo(
  ({ item, onRemove }: { item: ItemData; onRemove: (id: number) => void }) => {
    const [inView, setInView] = useState(false);

    return (
      <InView
        style={[styles.item, inView ? styles.itemVisible : styles.itemHidden]}
        triggerOnce={false}
        onChange={setInView}
      >
        <Text style={styles.title}>
          {item.title} — {inView ? 'IN VIEW' : 'HIDDEN'}
        </Text>
        <TouchableOpacity
          style={styles.removeBtn}
          onPress={() => onRemove(item.id)}
        >
          <Text style={styles.removeBtnText}>Remove</Text>
        </TouchableOpacity>
      </InView>
    );
  }
);

function DynamicRemovalTester() {
  const flatListRef = useRef<IOFlatListController>(null);
  const [data, setData] = useState<ItemData[]>(() =>
    generateItems(INITIAL_COUNT)
  );

  const removeSingle = useCallback((id: number) => {
    setData((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const removeFirst5 = useCallback(() => {
    setData((prev) => prev.slice(5));
  }, []);

  const removeEveryOther = useCallback(() => {
    setData((prev) => prev.filter((_, i) => i % 2 === 0));
  }, []);

  const removeRandom3 = useCallback(() => {
    setData((prev) => {
      const copy = [...prev];
      for (let i = 0; i < 3 && copy.length > 0; i++) {
        const idx = Math.floor(Math.random() * copy.length);
        copy.splice(idx, 1);
      }
      return copy;
    });
  }, []);

  const reset = useCallback(() => {
    setData(generateItems(INITIAL_COUNT));
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: ItemData }) => (
      <Item item={item} onRemove={removeSingle} />
    ),
    [removeSingle]
  );

  const keyExtractor = useCallback((item: ItemData) => String(item.id), []);

  return (
    <View style={styles.container}>
      <View style={styles.controls}>
        <TouchableOpacity style={styles.btn} onPress={removeFirst5}>
          <Text style={styles.btnText}>Remove first 5</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={removeEveryOther}>
          <Text style={styles.btnText}>Remove every other</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={removeRandom3}>
          <Text style={styles.btnText}>Remove random 3</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={reset}>
          <Text style={styles.btnText}>Reset ({data.length})</Text>
        </TouchableOpacity>
      </View>
      <IOFlatList
        ref={flatListRef}
        rootMargin={{ top: 0, bottom: 0 }}
        data={data}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 8,
    gap: 6,
  },
  btn: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  btnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  item: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 120,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
    borderBottomWidth: 1,
    paddingHorizontal: 16,
  },
  itemVisible: {
    backgroundColor: '#d4edda',
  },
  itemHidden: {
    backgroundColor: '#f8d7da',
  },
  title: {
    fontSize: 14,
    fontWeight: '500',
  },
  removeBtn: {
    marginTop: 8,
    backgroundColor: '#dc3545',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
  },
  removeBtnText: {
    color: '#fff',
    fontSize: 12,
  },
});

export default DynamicRemovalTester;
