import { BootEmptyViewSentinel } from '@cknerv/ui';

/** A Visual Review route with no source Cell is still a complete, presentable
 * view. Its DOM commit is the route's handoff proof because no Canvas mounts. */
export default function EmptyLabState() {
  return (
    <>
      <BootEmptyViewSentinel />
      <pre
        data-empty-lab="true"
        role="status"
        style={{ color: '#7C8794', padding: 20 }}
      >
        No Cell data available.
      </pre>
    </>
  );
}
