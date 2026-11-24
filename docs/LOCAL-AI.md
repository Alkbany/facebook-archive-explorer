# Local AI Features

Facebook Archive Explorer has two separate optional local-model features. They are independent, disabled by default, and do not require a hosted AI account.

## Semantic Search (embeddings)

- Model: `Xenova/multilingual-e5-small`, a multilingual feature-extraction model with 384-dimensional vectors.
- Runtime: `@huggingface/transformers` in the Electron main process.
- Quantization: Q4 ONNX model selection.
- Query input uses the model's `query:` prefix. Archived records use `passage:`.
- Vectors and model-versioned jobs are stored in the local SQLite database. The model files are cached under the Electron app's local user-data directory in `models`.
- Semantic retrieval scans eligible snapshot vectors but retains only the best requested page window in a bounded top-K heap, with stable record-ID tie-breaking; it does not load every embedding into a JavaScript result array.
- Enabling Semantic Search downloads the model, queues eligible existing records for backfill, and queues future imported records automatically.
- Work proceeds in small batches. A crash resets unfinished jobs for restart; failed batches can be retried. Embedding failures do not roll back a successful archive import.
- Disabling Semantic Search prevents new vector retrieval and pauses the queue. Existing vectors remain in the local database until they are rebuilt or removed as part of data lifecycle operations.

## AI Assistant (local LLM)

- Model: `onnx-community/Qwen2.5-0.5B-Instruct`, using Q4 ONNX weights.
- Runtime: the same Transformers.js package, but a separate model pipeline and separate opt-in setting.
- Model files are cached in the app's local user-data directory under `models/assistant`.
- The assistant retrieves a bounded set of locally indexed records and passes those excerpts to the local model. When Semantic Search is enabled, lexical BM25 and semantic cosine rankings are combined with reciprocal-rank fusion (RRF); duplicate records receive a combined rank contribution. If semantic retrieval is disabled or fails, the assistant falls back to lexical evidence. It is not an external inference API.
- Answers are required to cite source IDs such as `[S1]`. Only source IDs that exist in the retrieved evidence are kept, and every sentence or non-heading line must contain at least one valid citation. If any statement is uncited, the complete generated answer and its navigation cards are withheld. The UI shows the source file, section, card position, date, and record id, and can jump to the matching file in Archive Files.
- If no evidence is found, the UI presents that result rather than asking the model to invent an answer.
- The assistant is currently a beta foundation. Its lexical retrieval and citation checks are covered by automated tests; real model output quality, Arabic answer quality, and complete citation coverage still require manual validation on a representative archive. A 0.5B model can be less reliable than a larger local model.

## Message privacy

- Message text remains excluded from global search and assistant evidence by default.
- The separate **Include message text in global search** setting is an explicit opt-in. It controls the local message FTS index and message eligibility for Semantic Search and AI Assistant evidence.
- Turning the setting off clears message text from the separate global FTS index and removes message embeddings/jobs.
- When it is off, the Messages section remains available for direct exact on-demand search without creating a persistent message index.

## Network and data handling

The only expected network activity for these features is downloading model/tokenizer files after the owner explicitly enables that model. Archive contents, retrieved excerpts, embeddings, and assistant prompts stay on the device; they are not sent to a model provider or hosted inference service. Original Facebook export files remain read-only.

## Known limitations

- Multi-snapshot/compare questions remain future work. RRF combines the two bounded retrieval rankings but does not guarantee that every generated sentence is entailed by its cited excerpt.
- Sentence-level citation coverage ensures that every displayed claim has at least one retrieved source ID. It does not prove that the cited excerpt actually entails the claim or that the model interpreted the excerpt correctly; users should inspect the source cards for important conclusions.
- The small local LLM may simplify long or complicated questions. Missing evidence must be treated as missing, not as permission to infer.
- Model downloads require an internet connection once per model/version. Search and browsing continue to work when models are disabled or unavailable.
