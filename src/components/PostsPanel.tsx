import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { posts, WRITING_URL } from '../content'
import { PanelHeader } from './PanelHeader'
import './PostsPanel.css'

export function PostsPanel() {
  return (
    <section className="panel posts-panel" id="posts" aria-labelledby="posts-title">
      <PanelHeader id="posts-title" title="FEATURED_POSTS">
        <a className="panel-link" href={WRITING_URL}>
          ALL WRITING <ArrowRight size={14} />
        </a>
      </PanelHeader>
      <ol className="post-list">
        {posts.map((post) => (
          <li key={post.slug}>
            <a href={`${WRITING_URL}/${post.slug}`}>
              <time dateTime={post.date}>{post.date}</time>
              <span className="post-title">
                {post.title}
                <ArrowUpRight size={16} strokeWidth={1.5} aria-hidden="true" />
              </span>
              <span className="post-subtitle">{post.subtitle}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  )
}
