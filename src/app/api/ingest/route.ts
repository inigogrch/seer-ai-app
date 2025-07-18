/**
 * API Route: /api/ingest
 * 
 * Cron endpoint for scheduled ingestion runs
 * This endpoint is called by Vercel Cron to trigger the ingestion process
 */

import { NextResponse } from 'next/server';
import { ingestionCronHandler } from '../../../agents/ingestionAgent';

// Verify cron secret if provided
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: Request) {
  try {
    // Verify cron secret in production
    if (CRON_SECRET) {
      const authHeader = request.headers.get('authorization');
      if (authHeader !== `Bearer ${CRON_SECRET}`) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
    }

    // Run the ingestion
    const result = await ingestionCronHandler();
    
    return NextResponse.json(result.body, { 
      status: result.statusCode 
    });
  } catch (error) {
    console.error('Ingestion cron error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Also support POST for manual triggers
export async function POST(request: Request) {
  return GET(request);
} 