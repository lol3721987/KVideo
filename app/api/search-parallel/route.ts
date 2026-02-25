/**
 * Parallel Streaming Search API Route
 * Searches all sources in parallel and streams results immediately as they arrive
 * No waiting - results flow in real-time
 */

import { NextRequest } from 'next/server';
import { searchVideos } from '@/lib/api/client';
import { getSourceName } from '@/lib/utils/source-names';

export const runtime = 'edge';

const DEFAULT_SEARCH_CONCURRENCY = 4;
const MAX_SEARCH_CONCURRENCY = 12;

function getSearchConcurrency(): number {
  const raw = Number.parseInt(process.env.SEARCH_PARALLEL_CONCURRENCY || '', 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_SEARCH_CONCURRENCY;
  }
  return Math.min(MAX_SEARCH_CONCURRENCY, raw);
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const body = await request.json();
        const { query, sources: sourceConfigs, page = 1 } = body;
        const targetPage = Number.isInteger(page) && page > 0 ? page : 1;
        const trimmedQuery = String(query || '').trim();

        // Validate input
        if (!trimmedQuery) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            message: 'Invalid query'
          })}\n\n`));
          controller.close();
          return;
        }

        // Use provided sources or fallback to empty (client should provide them)
        const sources = Array.isArray(sourceConfigs) && sourceConfigs.length > 0
          ? sourceConfigs
          : [];

        if (sources.length === 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            message: 'No valid sources provided'
          })}\n\n`));
          controller.close();
          return;
        }

        // Send initial status
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'start',
          totalSources: sources.length
        })}\n\n`));



        // Track progress
        let completedSources = 0;
        let totalVideosFound = 0;
        let maxPageCount = 1;

        const searchSource = async (source: any) => {
          const startTime = performance.now(); // Track start time
          try {
            const sourceId = typeof source?.id === 'string' ? source.id : '';
            if (!sourceId) {
              throw new Error('Invalid source id');
            }

            // Search only the requested page for this source.
            const result = await searchVideos(trimmedQuery, [source], targetPage);
            const endTime = performance.now(); // Track end time
            const latency = Math.round(endTime - startTime); // Calculate latency in ms
            const videos = result[0]?.results || [];
            const pagecount = result[0]?.pagecount ?? 1;

            completedSources++;
            totalVideosFound += videos.length;
            maxPageCount = Math.max(maxPageCount, pagecount);

            // Stream current-page videos immediately
            if (videos.length > 0) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'videos',
                videos: videos.map((video: any) => ({
                  ...video,
                  sourceDisplayName: getSourceName(sourceId),
                  latency,
                })),
                source: sourceId,
                completedSources,
                totalSources: sources.length,
                latency,
                page: targetPage,
                pagecount,
              })}\n\n`));
            }

            // Send progress update for current page
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'progress',
              completedSources,
              totalSources: sources.length,
              totalVideosFound
            })}\n\n`));
          } catch (error) {
            const endTime = performance.now();
            const latency = Math.round(endTime - startTime);
            const sourceId = typeof source?.id === 'string' ? source.id : 'unknown';
            // Log error but continue with other sources
            console.error(`[Search Parallel] Source ${sourceId} failed after ${latency}ms:`, error);
            completedSources++;

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'progress',
              completedSources,
              totalSources: sources.length,
              totalVideosFound
            })}\n\n`));
          }
        };

        // Run with bounded concurrency to avoid CPU spikes.
        const concurrency = Math.min(getSearchConcurrency(), sources.length);
        let nextIndex = 0;
        const workers = Array.from({ length: concurrency }, async () => {
          while (true) {
            const current = nextIndex++;
            if (current >= sources.length) break;
            await searchSource(sources[current]);
          }
        });
        await Promise.all(workers);



        // Send completion signal
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'complete',
          totalVideosFound,
          totalSources: sources.length,
          maxPageCount
        })}\n\n`));

        controller.close();

      } catch (error) {
        console.error('Search error:', error);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : 'Unknown error'
        })}\n\n`));
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}


