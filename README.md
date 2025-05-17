# Hacker News to Notion

Hacker Newsの注目記事を自動的にNotionデータベースに保存するツールです。

## 機能

- Hacker Newsのトップ記事を取得
- 記事本文の取得と要約
- コメントの取得と要約
- Notionデータベースへの自動保存

## セットアップ

1. リポジトリをクローン
```bash
git clone [repository-url]
cd HackerNews
```

2. 依存パッケージのインストール
```bash
npm install
```

3. 環境変数の設定
`.env`ファイルを作成し、以下の変数を設定してください：
```
NOTION_TOKEN=your_notion_integration_token
NOTION_DATABASE_ID=your_notion_database_id
OPENAI_API_KEY=your_openai_api_key
```

## 使用方法

記事の取得と保存：
```bash
npm fetch
```

週間まとめ記事の生成：
```bash
npm generate
```

## 必要な環境

- Node.js 16以上
- Notion APIのインテグレーショントークン
- OpenAI APIキー

## ライセンス

MIT
