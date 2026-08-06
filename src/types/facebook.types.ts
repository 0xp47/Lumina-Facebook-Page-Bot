export interface GraphApiErrorResponse {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

export interface PageInfo {
  id: string;
  name: string;
  about?: string;
  description?: string;
  fan_count?: number;
  followers_count?: number;
  link?: string;
  category?: string;
  cover?: {
    id?: string;
    source?: string;
  };
}

export interface CreatePostPayload {
  message: string;
  link?: string;
  picture?: string;
  published?: boolean;
  scheduled_publish_time?: number;
}

export interface CreatePostResponse {
  id: string;
}

export interface Comment {
  id: string;
  message: string;
  created_time: string;
  from?: {
    id: string;
    name: string;
  };
  like_count?: number;
  comment_count?: number;
}

export interface CommentsListResponse {
  data: Comment[];
  paging?: {
    cursors: {
      before: string;
      after: string;
    };
    next?: string;
  };
}

export interface CreateCommentPayload {
  message: string;
}

export interface CreateCommentResponse {
  id: string;
}

export interface InsightValue {
  value: number | Record<string, number>;
  end_time?: string;
}

export interface InsightMetric {
  name: string;
  period: string;
  values: InsightValue[];
  title?: string;
  description?: string;
  id: string;
}

export interface InsightsListResponse {
  data: InsightMetric[];
  paging?: {
    previous?: string;
    next?: string;
  };
}

export interface TaggedPost {
  id: string;
  message?: string;
  created_time: string;
  from?: {
    id: string;
    name: string;
  };
}

export interface SendMessagePayload {
  recipient: {
    id: string;
  };
  message: {
    text?: string;
    attachment?: {
      type: 'image' | 'video' | 'audio' | 'file' | 'template';
      payload: Record<string, any>;
    };
    quick_replies?: Array<{
      content_type: 'text' | 'user_phone_number' | 'user_email';
      title?: string;
      payload?: string;
    }>;
  };
  messaging_type?: 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG';
}

export interface SendMessageResponse {
  recipient_id: string;
  message_id: string;
}
