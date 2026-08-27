import { u } from '../lib/stage.js';
import { PILL } from '../data/heroNodes.js';

/**
 * The 142 x 40 rounded pill used for every call to action in the hero:
 * a node dot on the left, label text on the right.
 *
 * `tone="node"` is the blue-tinted pill used by the four map categories;
 * `tone="glass"` is the white-tinted variant used by Search in the header.
 */
export default function NodePill({
  as: Tag = 'a',
  tone = 'node',
  children,
  className = '',
  style,
  ...props
}) {
  // material-chip adds the backdrop blur, so these read as glass over the
  // dendrite artwork rather than as a flat tint.
  const tint =
    tone === 'glass'
      ? 'material-chip bg-platinum/10 hover:bg-platinum/15'
      : 'material-chip bg-jordy/20 hover:bg-jordy/30';

  return (
    <Tag
      {...props}
      style={{
        width: u(PILL.w),
        height: u(PILL.h),
        paddingLeft: u(PILL.padLeft),
        paddingRight: u(PILL.padRight),
        fontSize: u(PILL.text),
        letterSpacing: PILL.tracking,
        ...style,
      }}
      className={`group pressable flex items-center justify-between rounded-full ${tint} text-platinum no-underline transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-jordy focus-visible:ring-offset-2 focus-visible:ring-offset-delft ${className}`}
    >
      <span
        style={{ width: u(PILL.dot * 2), height: u(PILL.dot * 2) }}
        className="shrink-0 rounded-full bg-jordy transition-transform duration-200 motion-safe:group-hover:scale-125"
      />
      <span className="whitespace-nowrap">{children}</span>
    </Tag>
  );
}
