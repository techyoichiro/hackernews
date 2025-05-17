import { Client } from '@notionhq/client'
import { config } from 'dotenv'
import fs from 'fs/promises'
import path from 'path'

config()

interface NotionPage {
  id: string
  properties: {
    Name: { title: [{ text: { content: string } }] }
    URL: { url: string }
    ArticleSummary: { rich_text: [{ text: { content: string } }] }
    CommentSummary: { rich_text: [{ text: { content: string } }] }
    Score: { number: number }
    PostedAt: { date: { start: string } }
  }
}

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const DATABASE_ID = process.env.NOTION_DATABASE_ID!
const OUTPUT_DATABASE_ID = process.env.NOTION_OUTPUT_DATABASE_ID! // note記事用の別データベース

async function getNotionPages(days: number = 7) {
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    sorts: [
      {
        property: 'PostedAt',
        direction: 'descending',
      },
    ],
    filter: {
      and: [
        {
          property: 'PostedAt',
          date: {
            after: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
          },
        },
      ],
    },
  })

  // Notionのレスポンスを適切に型変換
  return (response.results as unknown as NotionPage[]).filter(
    (page): page is NotionPage => 
      'properties' in page && 
      'Name' in page.properties &&
      'URL' in page.properties &&
      'ArticleSummary' in page.properties &&
      'CommentSummary' in page.properties &&
      'Score' in page.properties &&
      'PostedAt' in page.properties
  )
}

function generateNoteArticle(pages: NotionPage[]) {
  const now = new Date()
  const weekNumber = Math.ceil(now.getDate() / 7)
  const month = now.toLocaleString('ja-JP', { month: 'long' })

  let content = `🗓 ${now.getFullYear()}年${month} 第${weekNumber}週｜Hacker News 注目記事まとめ\n\n`
  content += '---\n\n'

  // スコア順にソート
  const sortedPages = [...pages].sort((a, b) => b.properties.Score.number - a.properties.Score.number)

  for (const page of sortedPages) {
    const title = page.properties.Name.title[0]?.text.content || 'タイトルなし'
    const url = page.properties.URL.url || ''
    const articleSummary = page.properties.ArticleSummary.rich_text[0]?.text.content || ''
    const commentSummary = page.properties.CommentSummary.rich_text[0]?.text.content || ''

    content += `### 🔸 [${title}](${url})\n\n`
    content += `✅ 記事の要約\n${articleSummary}\n\n`
    
    if (commentSummary !== 'コメントはありません') {
      content += `💬 コメントの要約\n${commentSummary}\n\n`
    }
    
    content += '---\n\n'
  }

  content += 'ご意見・ご感想はぜひコメントで！🙌\n'
  return content
}

async function saveToNotion(content: string, pages: NotionPage[]) {
  const now = new Date()
  const title = `Hacker News 注目記事まとめ ${now.toLocaleDateString('ja-JP')}`
  
  // ページを作成
  const page = await notion.pages.create({
    parent: { database_id: OUTPUT_DATABASE_ID },
    properties: {
      Name: {
        title: [{ text: { content: title } }],
      },
      Status: {
        status: { name: 'Draft' },
      },
      GeneratedAt: {
        date: {
          start: now.toISOString(),
        },
      },
    },
  })

  // コンテンツを記事ごとに分割
  const articles = content.split('---\n\n').filter(article => article.trim())
  
  // 最初の記事をContentプロパティに保存（タイトル + 最初の記事）
  if (articles.length > 1) {
    const firstArticle = articles[0] + '---\n\n' + articles[1];
    await notion.pages.update({
      page_id: page.id,
      properties: {
        Content: {
          rich_text: [{ text: { content: firstArticle } }],
        } as any,
      },
    })
  }

  // 残りの記事をブロックとして追加
  if (articles.length > 2) {
    const blocks = articles.slice(2).map(article => ({
      object: 'block' as const,
      type: 'paragraph' as const,
      paragraph: {
        rich_text: [{ text: { content: article } }],
      },
    }))

    await notion.blocks.children.append({
      block_id: page.id,
      children: blocks,
    })
  }
}

async function main() {
  try {
    // 過去7日分の記事を取得
    const pages = await getNotionPages(7)
    
    // note用の記事を生成
    const content = generateNoteArticle(pages)
    
    // 生成した記事をNotionに保存
    await saveToNotion(content, pages)
    
    console.log('✅ Note記事を生成してNotionに保存しました')
  } catch (error) {
    console.error('Error:', error)
  }
}

main() 