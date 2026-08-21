# Evaluation

The system was evaluated on retrieval, answer generation, and agent routing using the saved final result files.

## 1. Retrieval

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

The required text evidence is usually in the top five and often near rank 1. Document Recall@5 is 100%, so the right PDF is always retrieved; the 9 text failures are page/section misses, not wrong documents. Image Recall@1 and @5 are equal because the pipeline typically returns about two images, so a miss at rank 1 is also a miss at rank 5.

| Language | Cases | Recall@1 | Recall@5 | MRR@5 | Document Recall@5 |
|---|---:|---:|---:|---:|---:|
| Arabic | 27 | 77.8% | **100%** | 85.9% | 100% |
| French | 18 | 72.2% | 94.4% | 80.6% | 100% |
| English | 130 | 74.6% | 93.8% | 83.0% | 100% |
| Cross-language | 6 | 66.7% | 83.3% | 75.0% | 100% |

Arabic is the strongest language split. Cross-language queries still find the correct document every time, but page-level recall drops because the gold section is harder to rank when the query language differs from the PDF.

Result file: `services/gatherly_rag/data/rag/evaluations/final_retrieval_results.json`

## 2. Generation

All 61 questions were answered by `gemini-3.5-flash` and judged by `gemini-3.6-flash` on a 1–4 rubric.

| Group | Cases | RAG mode accuracy | Faithfulness | Correctness | Relevance |
|---|---:|---:|---:|---:|---:|
| Overall | 61 | 91.8% | **3.77/4 (94.3%)** | **3.57/4 (89.3%)** | **3.90/4 (97.5%)** |
| Text | 51 | 96.1% | 3.94/4 | 3.63/4 | 3.88/4 |
| Visual | 10 | 70.0% | 2.90/4 | 3.30/4 | 4.00/4 |
| Cross-language | 6 | 100% | 4.00/4 | 3.17/4 | 3.67/4 |

Answers stay close to the retrieved context and to the question. Correctness is the weakest judge score, mainly from incomplete coverage of the gold answer rather than hallucination. Visual questions are the weak split: modality routing is 70% and faithfulness drops to 2.90, while text questions are nearly always routed correctly and stay faithful.

| Language | Cases | Faithfulness | Correctness | Relevance |
|---|---:|---:|---:|---:|
| Arabic | 27 | 4.00/4 | 3.81/4 | 4.00/4 |
| French | 4 | 4.00/4 | 3.50/4 | 4.00/4 |
| English | 30 | 3.53/4 | 3.37/4 | 3.80/4 |

Arabic and French answers are almost fully faithful. English is lower because several sustainability and wedding-guide questions mix similar PDFs, so the judge penalizes missing gold details even when the reply is on-topic.

RAG mode accuracy here is text vs visual retrieval, not supervisor specialist routing.

Result file: `services/gatherly_rag/data/rag/evaluations/final_generation_results.json`

## 3. Agent routing

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

Specialists for SQL, readiness, briefing, explorer, debrief, ops, invitation, multi-step, and guards all routed correctly. The two failures are `rag-001` (attached inspiration image went to `rag_agent` instead of `visual_style_agent`) and `gen-003` (Gemini 503, so no route was recorded). Tool-selection fields were empty in this run and should not be reported as 0% tool accuracy.

Result file: `services/agent-a/evaluation/results/agent_eval_results.json`

## 4. Conclusion

Retrieval finds the right document for every text question and the gold page for 94.9%. Generation is strongly faithful (94.3%) and relevant (97.5%). The supervisor routes correctly in 93.3% of cases. The remaining gaps are visual RAG (mode routing and faithfulness), English completeness vs gold answers, and one image-attachment supervisor miss.