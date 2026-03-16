import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getAllTasks, createTask } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const tasks = getAllTasks();
    return NextResponse.json({ tasks });
  } catch (err) {
    console.error('GET /api/tasks error:', err);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { description } = body;

    if (!description) {
      return NextResponse.json({ error: 'description is required' }, { status: 400 });
    }

    const task = {
      id: uuidv4(),
      description,
      status: 'pending' as const,
      agent_id: null,
      created_at: Date.now(),
      result: null,
    };

    createTask(task);
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    console.error('POST /api/tasks error:', err);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
