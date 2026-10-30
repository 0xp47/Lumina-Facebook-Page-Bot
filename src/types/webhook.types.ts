export interface WebhookVerificationQuery {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
}

export interface WebhookMessagingEvent {
  sender: {
    id: string;
  };
  recipient: {
    id: string;
  };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    attachments?: Array<{
      type: string;
      payload: {
        url?: string;
      };
    }>;
  };
  postback?: {
    title: string;
    payload: string;
  };
}

export interface WebhookFeedValue {
  item: 'post' | 'comment' | 'like' | 'status' | 'photo' | 'video';
  verb: 'add' | 'edited' | 'deleted' | 'hide' | 'unhide';
  post_id?: string;
  comment_id?: string;
  parent_id?: string;
  sender_id?: string;
  sender_name?: string;
  message?: string;
  created_time?: number;
}

export interface WebhookChange {
  field: 'feed' | 'mentions' | 'messages' | 'conversations';
  value: WebhookFeedValue | any;
}

export interface WebhookEntry {
  id: string;
  time: number;
  changes?: WebhookChange[];
  messaging?: WebhookMessagingEvent[];
}

export interface WebhookPayload {
  object: 'page';
  entry: WebhookEntry[];
}
