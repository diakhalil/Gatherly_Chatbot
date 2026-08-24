# Evaluation

## Final System Evaluation

### 1. Retrieval

Text retrieval used hybrid search with theme reorder, `BAAI/bge-m3`, and `cross-encoder/mmarco-mMiniLMv2-L12-H384-v1` at K=5 (175 questions). Image retrieval used `intfloat/multilingual-e5-base` with retrieve-rerank fallback (108 questions).

| Metric | Text (n=175) | Image (n=108) |
|---|---:|---:|
| Recall@1 | 74.9% | 91.7% |
| Recall@5 | **94.9%** | **91.7%** |
| MRR@5 | **83.2%** | **91.7%** |
| NDCG@5 | **85.5%** | — |
| Document Recall@1 | **94.9%** | — |
| Document Recall@5 | **100%** | — |
| Page Recall@5 | **93.7%** | — |
| Coverage@5 | — | **91.4%** |
| Failures | 9 | 9 |
| Mean latency | 236 ms | 42 ms |

The required text evidence is usually in the top five and often near rank 1. Document Recall@5 is 100%, so the right PDF is always retrieved; the 9 text failures are page/section misses.

| Language | Cases | Recall@1 | Recall@5 | MRR@5 | Document Recall@5 |
|---|---:|---:|---:|---:|---:|
| Arabic | 27 | 77.8% | **100%** | 85.9% | 100% |
| French | 18 | 72.2% | 94.4% | 80.6% | 100% |
| English | 130 | 74.6% | 93.8% | 83.0% | 100% |
| Cross-language | 6 | 66.7% | 83.3% | 75.0% | 100% |

Arabic is the strongest language split. Cross-language queries still find the correct document every time, but page-level recall drops because the gold section is harder to rank when the query language differs from the PDF.

Result file: `services/gatherly_rag/data/rag/evaluations/final_retrieval_results.json`

### 2. Generation

All 61 questions were answered by `gemini-3.5-flash` and judged by `gemini-3.6-flash` on a 1–4 rubric.

| Group | Cases | Faithfulness | Correctness | Relevance |
|---|---:|---:|---:|---:|---:|
| Overall | 61 | **3.77/4 (94.3%)** | **3.57/4 (89.3%)** | **3.90/4 (97.5%)** |
| Text | 51 | 3.94/4 | 3.63/4 | 3.88/4 |
| Visual | 10  | 2.90/4 | 3.30/4 | 4.00/4 |
| Cross-language | 6| 4.00/4 | 3.17/4 | 3.67/4 |

Answers stay close to the retrieved context and to the question. Correctness is the weakest judge score, mainly from incomplete coverage of the gold answer rather than hallucination. Visual questions are the weak split: modality routing is 70% and faithfulness drops to 2.90, while text questions are nearly always routed correctly and stay faithful.

| Language | Cases | Faithfulness | Correctness | Relevance |
|---|---:|---:|---:|---:|
| Arabic | 27 | 4.00/4 | 3.81/4 | 4.00/4 |
| French | 4 | 4.00/4 | 3.50/4 | 4.00/4 |
| English | 30 | 3.53/4 | 3.37/4 | 3.80/4 |

Arabic and French answers are almost fully faithful. English is lower because several sustainability and wedding-guide questions mix similar PDFs, so the judge penalizes missing gold details even when the reply is on-topic.

RAG mode accuracy here is text vs visual retrieval, not supervisor specialist routing.

Result file: `services/gatherly_rag/data/rag/evaluations/final_generation_results.json`

### 3. Agent routing

The latest agent run scored 39 cases. Routing was checked on 30 of them.

| Metric | Result |
|---|---:|
| Correct routes | 28/30 |
| Routing accuracy | **93.3%** |
| Overall passed cases | **37/39 (94.9%)** |

| Category | Passed | Total | Pass rate |
|---|---:|---:|---:|
| Routing (SQL) | 6 | 6 | 100% |
| Readiness | 3 | 3 | 100% |
| Host briefing | 3 | 3 | 100% |
| Client explorer | 3 | 3 | 100% |
| Debrief | 3 | 3 | 100% |
| Event ops | 3 | 3 | 100% |
| Invitation | 2 | 2 | 100% |
| Multi-step | 3 | 3 | 100% |
| RAG | 2 | 2 | 100% |
| Guards | 4 | 4 | 100% |
| Smoke | 2 | 2 | 100% |
| General | 2 | 3 | 66.7% |
| Visual style | 1 | 2 | 50.0% |

Specialists for SQL, readiness, briefing, explorer, debrief, ops, invitation, multi-step, and guards all routed correctly. The two failures are `rag-001` (attached inspiration image went to `rag_agent` instead of `visual_style_agent`) and `gen-003` (Gemini 503, so no route was recorded).

Result file: `services/agent-a/evaluation/results/agent_eval_results.json`

## Experiment Evaluations

These experiments were used to select each stage of the multimodal retrieval pipeline before the final end-to-end evaluation.

### 1. Text chunking

Five chunking strategies were compared on 42 queries across 20 documents. A result counted as relevant when both its document and page matched the labeled evidence.

| Strategy | Chunks | Median characters | Recall@1 | Recall@5 | MRR@5 |
|---|---:|---:|---:|---:|---:|
| Fixed-size | 786 | 723 | 57.1% | 78.6% | 64.9% |
| Recursive | 787 | 707 | **59.5%** | 76.2% | **67.1%** |
| Sentence | 3,581 | 149 | 47.6% | 73.8% | 58.9% |
| Structure-aware | 880 | 558 | 52.4% | 78.6% | 62.7% |
| Semantic | 775 | 696 | 52.4% | **83.3%** | 65.5% |

Semantic chunking was selected because it produced the highest Recall@5 with fewer chunks. Sentence chunking fragmented the corpus into 3,581 mostly short units, including 730 chunks below 100 characters, and gave the weakest ranking quality. All strategies passed integrity checks for non-empty text, unique IDs, valid pages, source files, and configured size limits.

Source: [`3_chunking_experiments.ipynb`](services/gatherly_rag/doc_notebooks/3_chunking_experiments.ipynb)

### 2. Text embedding models

Text retrieval was optimized in two steps. First, three multilingual embedding models were evaluated on the semantic chunks:

| Embedding model | Dimensions | Recall@1 | Recall@5 | MRR@5 |
|---|---:|---:|---:|---:|
| `BAAI/bge-m3` | 1,024 | **59.5%** | **83.3%** | **69.9%** |
| `intfloat/multilingual-e5-base` | 768 | 52.4% | **83.3%** | 65.5% |
| `paraphrase-multilingual-MiniLM-L12-v2` | 384 | 28.6% | 42.9% | 32.9% |

`BAAI/bge-m3` was selected because it tied for the best Recall@5 while ranking relevant passages earlier.

Source: [`4_embedding_retrieval_experiments.ipynb`](services/gatherly_rag/doc_notebooks/4_embedding_retrieval_experiments.ipynb)

### 3. Text retrieval methods

Dense, lexical, hybrid, reranked, and multi-query retrieval were compared on 38 selection queries using the selected BGE-M3 embeddings.

| Method | Recall@1 | Recall@5 | MRR@5 | Mean latency |
|---|---:|---:|---:|---:|
| Dense | 57.9% | 92.1% | **71.0%** | 60 ms |
| TF-IDF | 34.2% | 63.2% | 46.5% | **4 ms** |
| Hybrid RRF | 52.6% | 86.8% | 67.3% | 39 ms |
| Dense with reranking | 52.6% | 89.5% | 67.8% | 1,702 ms |
| Hybrid with reranking | 55.3% | **94.7%** | 70.6% | 1,628 ms |
| Multi-query | **60.5%** | 84.2% | 70.0% | 116 ms |

Hybrid retrieval followed by cross-encoder reranking was selected because it achieved the highest Recall@5, reducing failures to 2 of 38 queries. Dense search ranked individual hits slightly earlier, while TF-IDF was fastest but missed many semantic and multilingual matches. A lightweight theme-aware reorder preserved Recall@5 and raised MRR@5 from 70.6% to 71.2% without changing the retrieved result set.

Source: [`5_retrieval_method_experiments.ipynb`](services/gatherly_rag/doc_notebooks/5_retrieval_method_experiments.ipynb)

### 4. Image context

The image-context stage was inspected across 480 images from 16 PDFs. Each record combines:
- document title
- section heading
- nearby page text
- VLM-generated visual description

Representative records were reviewed alongside their source image to confirm that textual context described both the surrounding topic and visible content. OCR was intentionally excluded at this stage so its effect could be evaluated separately. This notebook validates context completeness and alignment; it does not report a retrieval accuracy score.

Source: [`6_image_context_experiments.ipynb`](services/gatherly_rag/doc_notebooks/6_image_context_experiments.ipynb)

### 5. Image-context embeddings

Three text-embedding models were compared by embedding the combined image-context strings and retrieving labeled images for 93 queries.

| Embedding model | Dimensions | Recall@1 | Recall@5 | MRR@5 |
|---|---:|---:|---:|---:|
| `intfloat/multilingual-e5-base` | 768 | **58.1%** | **87.1%** | **69.5%** |
| `BAAI/bge-m3` | 1,024 | 53.8% | 83.9% | 65.7% |
| `paraphrase-multilingual-MiniLM-L12-v2` | 384 | 25.8% | 52.7% | 35.6% |

`intfloat/multilingual-e5-base` was selected because it led on Recall@1, Recall@5, and MRR@5. This differs from text retrieval, where BGE-M3 performed better, so the production pipeline uses separate embedding models for text chunks and image context.

Source: [`8_image_context_embedding_experiments.ipynb`](services/gatherly_rag/doc_notebooks/8_image_context_embedding_experiments.ipynb)

### 6. Image-context retrieval

Image retrieval compared direct context search with two-stage retrieve-and-rerank variants. The experiment used 93 labeled queries, `candidate_k=15`, and evaluated both hit rate and how much irrelevant visual content was returned.

The compared methods work as follows:

- **Context dense:** embeds the query and searches every image's complete context, including its document, section, nearby text, and VLM description.
- **Retrieve-rerank:** retrieves 15 candidates from short topic or heading embeddings, then reranks those candidates using their full image-context embeddings. It improves the order of relevant results without restricting them to one section.
- **Section-filtered rerank:** uses the highest-scoring reranked image as an anchor, keeps images from the same document and section, and ranks that smaller set by full-context similarity. This reduces unrelated results but can miss relevant images when the section is wrong.
- **Rerank with fallback:** starts with section-filtered reranking. When the anchor confidence is below a threshold, it falls back to full-corpus context-dense retrieval instead of trusting an uncertain section.

| Method | Section precision@5 | Coverage@5 | Recall@5 | MRR@5 | Mean results |
|---|---:|---:|---:|---:|---:|
| Context dense | 28.2% | 74.9% | **88.2%** | 69.8% | 5.00 |
| Retrieve-rerank | 28.8% | **75.8%** | 87.1% | **75.2%** | 5.00 |
| Section-filtered rerank | **67.7%** | 66.1% | 68.8% | 67.6% | 2.18 |
| Rerank with fallback at 0.82 | **67.7%** | 66.1% | 68.8% | 67.6% | 2.31 |

The fallback method was selected to retain the precision while providing a recovery path for uncertain section anchors.

#### Fallback threshold selection

The confidence threshold controls when the method abandons section-filtered results and uses dense retrieval. A higher threshold triggers fallback more often, increasing recall and coverage but also returning more unrelated images.

| Threshold | Fallback rate | Section precision@5 | Coverage@5 | Recall@5 | MRR@5 | Mean results |
|---:|---:|---:|---:|---:|---:|---:|
| 0.70 | 0.0% | **67.7%** | 66.1% | 68.8% | 67.6% | 2.18 |
| 0.75 | 0.0% | **67.7%** | 66.1% | 68.8% | 67.6% | 2.18 |
| 0.80 | 0.0% | **67.7%** | 66.1% | 68.8% | 67.6% | 2.18 |
| **0.82** | **3.2%** | **67.7%** | 66.1% | 68.8% | 67.6% | 2.31 |
| 0.85 | 40.9% | 54.6% | 69.6% | 77.4% | **69.1%** | 3.30 |
| 0.88 | 93.6% | 29.5% | **73.4%** | **84.9%** | 69.0% | 4.82 |

The locked threshold was **0.82**. It was the highest tested threshold that kept the fallback rate below 10% while preserving the maximum section precision. It invoked dense retrieval for only 3 of 93 queries. Thresholds of 0.85 and 0.88 recovered more labeled images, but their frequent fallback sharply reduced section precision and moved the behavior closer to always-on dense retrieval.

Source: [`9_combined_text_image_retrieval.ipynb`](services/gatherly_rag/doc_notebooks/9_combined_text_image_retrieval.ipynb)
