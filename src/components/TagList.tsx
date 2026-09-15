export function TagList({ tags }: { tags: readonly string[] }) {
  return (
    <span className="project-tags">
      {tags.map((tag) => (
        <span key={tag}>{tag}</span>
      ))}
    </span>
  )
}
