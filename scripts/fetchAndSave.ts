import { Client } from '@notionhq/client'
import { config } from 'dotenv'
import fetch from 'node-fetch'
import { OpenAI } from 'openai'
import * as cheerio from 'cheerio'

config()

interface HackerNewsItem {
  id: number
  title: string
  url?: string
  text?: string
  time: number
  by: string
  kids?: number[]
  score: number
}

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const DATABASE_ID = process.env.NOTION_DATABASE_ID!

// 記事本文を取得する関数
async function fetchArticleContent(url: string): Promise<string> {
  try {
    const response = await fetch(url)
    const html = await response.text()
    const $ = cheerio.load(html)
    
    // メタタグから説明を取得
    const metaDescription = $('meta[name="description"]').attr('content') || ''
    
    // 本文を取得（一般的な記事の構造に基づいて）
    let content = ''
    
    // 1. articleタグ内のテキスト
    $('article').each((_, el) => {
      content += $(el).text().trim() + '\n'
    })
    
    // 2. mainタグ内のテキスト
    if (!content) {
      $('main').each((_, el) => {
        content += $(el).text().trim() + '\n'
      })
    }
    
    // 3. 特定のクラスやIDを持つ要素からテキスト
    if (!content) {
      $('.post-content, .article-content, .entry-content, #content').each((_, el) => {
        content += $(el).text().trim() + '\n'
      })
    }
    
    // 4. pタグのテキスト（最後の手段）
    if (!content) {
      $('p').each((_, el) => {
        content += $(el).text().trim() + '\n'
      })
    }
    
    // テキストのクリーニング
    content = content
      .replace(/\s+/g, ' ')  // 複数の空白を1つに
      .replace(/\n+/g, '\n') // 複数の改行を1つに
      .trim()
    
    // メタ説明と本文を組み合わせる
    return metaDescription + '\n\n' + content
  } catch (error) {
    console.error(`Error fetching article content from ${url}:`, error)
    return ''
  }
}

async function getTopStories(limit = 5) {
  const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json')
  const ids = (await res.json()) as number[]
  return ids.slice(0, limit)
}

async function getItem(id: number): Promise<HackerNewsItem | null> {
  const res = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
  return res.json() as Promise<HackerNewsItem | null>
}

async function getComments(kids: number[] = [], depth = 0): Promise<string[]> {
  if (depth > 2 || kids.length === 0) return [] // 最大2階層まで取得

  const comments = await Promise.all(
    kids.map(async (id) => {
      const comment = await getItem(id)
      if (!comment || !comment.text) return null
      
      const childComments = comment.kids ? await getComments(comment.kids, depth + 1) : []
      return {
        text: comment.text,
        by: comment.by,
        childComments
      }
    })
  )

  return comments
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .map(c => `${c.by}: ${c.text}${c.childComments.length > 0 ? '\n' + c.childComments.join('\n') : ''}`)
}

async function summarizeArticle(item: HackerNewsItem) {
  // 記事本文を取得
  let articleContent = item.text || ''
  if (item.url) {
    articleContent = await fetchArticleContent(item.url)
  }

  const prompt = `以下はHacker Newsの技術記事の情報です。日本語で400字以内に要約してください。記事の詳細リンクは必要ありません。

タイトル: ${item.title}
本文: ${articleContent}
投稿者: ${item.by}
スコア: ${item.score}
投稿日時: ${new Date(item.time * 1000).toLocaleString()}
URL: ${item.url || 'なし'}`

  const res = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content: 'あなたは日本語が得意な編集者です。英語の記事を読みやすく自然な日本語で要約してください。記事の詳細リンクは必要ありません。',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

  return res.choices[0].message.content?.trim() || ''
}

async function summarizeComments(comments: string[]) {
  if (comments.length === 0) return 'コメントはありません'

  const prompt = `以下はHacker Newsの記事に対するコメントです。日本語で200字以内に要約してください。

コメント:
${comments.slice(0, 5).join('\n\n')}`

  const res = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content: 'あなたは日本語が得意な編集者です。英語のコメントを読みやすく自然な日本語で要約してください。',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

  return res.choices[0].message.content?.trim() || ''
}

async function saveToNotion(item: HackerNewsItem, articleSummary: string, commentSummary: string) {
  await notion.pages.create({
    parent: { database_id: DATABASE_ID },
    properties: {
      Name: {
        title: [{ text: { content: item.title } }],
      },
      URL: {
        url: item.url || '',
      },
      ArticleSummary: {
        rich_text: [{ text: { content: articleSummary } }],
      },
      CommentSummary: {
        rich_text: [{ text: { content: commentSummary } }],
      },
      Author: {
        rich_text: [{ text: { content: item.by } }],
      },
      Score: {
        number: item.score,
      },
      PostedAt: {
        date: {
          start: new Date(item.time * 1000).toISOString(),
        },
      },
    },
  })
}

async function main() {
  const topIds = await getTopStories()

  for (const id of topIds) {
    const item = await getItem(id)
    if (!item || !item.title) continue

    const comments = item.kids ? await getComments(item.kids) : []
    const articleSummary = await summarizeArticle(item)
    const commentSummary = await summarizeComments(comments)
    
    await saveToNotion(item, articleSummary, commentSummary)

    console.log(`✅ Saved: ${item.title}`)
  }
}

main()
