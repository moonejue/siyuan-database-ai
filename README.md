# Database AI Applications

Bring configurable AI automation to SiYuan databases.

![Preview](preview.png)

[中文说明](README_zh_CN.md)

## Features

- Adds an `AI Applications` entry to each database.
- Summarize long text into concise results.
- Run custom AI instructions using any selected database fields.
- Classify rows using your own category list.
- Extract structured information such as names, phone numbers, and tags.
- Fill numeric columns with spreadsheet-like formulas.
- Preview the first 3 rows before applying an operation to a full column.

## Model Support

- Local models: Ollama and LM Studio.
- APIs: OpenAI, DeepSeek, Kimi, Zhipu GLM, Alibaba DashScope, Google Gemini, and Anthropic Claude.
- Aggregators: SiliconFlow and OpenRouter.
- Custom third-party APIs with configurable protocol, base URL, API key, and model name.

Remote requests are forwarded through SiYuan's kernel proxy to avoid browser CORS restrictions. When using a third-party API, selected database content is sent to that provider. API keys are stored only in the current SiYuan client.

## Formula Examples

```text
={Price}*{Quantity}
ROUND(AVG({Score 1},{Score 2}), 1)
SUM({Income},-{Expense})
```

Supported functions: `SUM`, `AVG`, `MIN`, `MAX`, `ROUND`, `ABS`, `COUNT`, `POW`, and `SQRT`.

## Usage

1. Open a document containing a database.
2. Click `AI Applications` in the database header.
3. Configure a local model or third-party API.
4. Choose an operation, input fields, and an output field.
5. Preview the first rows, then apply the operation to the full column.

## Support

If this plugin helps you, you can support the author via WeChat Pay.

<img src="assets/donate-wechat.jpg" alt="WeChat Pay donation QR code" width="320">

## License

[MIT](LICENSE)
