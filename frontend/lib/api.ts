// API client for backend communication

const IS_DEV = process.env.NODE_ENV === 'development';

/**
 * Normalizes NEXT_PUBLIC_API_URL so fetch URLs always use the /api prefix.
 * Examples: http://localhost:5000 → http://localhost:5000/api
 */
export function normalizeApiBaseUrl(raw: string): string {
  const trimmed = String(raw).trim().replace(/\/+$/, '');
  if (!trimmed) return 'http://localhost:5000/api';
  if (/\/api$/i.test(trimmed)) return trimmed;
  return `${trimmed}/api`;
}

export const API_BASE_URL = normalizeApiBaseUrl(
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'
);

/** Backend origin without /api (video uploads, static files). */
export function getServerOrigin(): string {
  return API_BASE_URL.replace(/\/api$/i, '');
}

function buildQuery(params?: Record<string, string | number | boolean | undefined | null>): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    sp.set(key, String(value));
  }
  const q = sp.toString();
  return q ? `?${q}` : '';
}

// Get token from localStorage (Bearer value only; trimmed)
const getToken = (): string | null => {
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem('token');
    if (raw == null) return null;
    const t = raw.trim();
    if (!t) return null;
    if (t.toLowerCase().startsWith('bearer ')) {
      return t.slice(7).trim() || null;
    }
    return t;
  }
  return null;
};

// Get user from localStorage
export const getStoredUser = () => {
  if (typeof window !== 'undefined') {
    const userStr = localStorage.getItem('user');
    if (!userStr) return null;
    try {
      return JSON.parse(userStr);
    } catch {
      return null;
    }
  }
  return null;
};

// Store auth data
export const storeAuth = (token: string, user: any) => {
  if (typeof window !== 'undefined') {
    const clean = typeof token === 'string' ? token.trim() : '';
    if (clean) {
      localStorage.setItem('token', clean);
    } else {
      localStorage.removeItem('token');
    }
    localStorage.setItem('user', JSON.stringify(user));
  }
};

// Clear auth data
export const clearAuth = () => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }
};

function parseApiErrorBody(data: unknown, response: Response, rawText: string): string {
  if (data === null && rawText.trim()) {
    const t = rawText.trim();
    if (t.startsWith('<')) {
      return `Server returned HTML (HTTP ${response.status}). Check NEXT_PUBLIC_API_URL — the API base may be wrong or the server returned an error page.`;
    }
    return t.length > 300 ? `${t.slice(0, 297)}…` : t;
  }

  if (!data || typeof data !== 'object') {
    if (response.status === 404) {
      return 'API endpoint not found. Ensure the backend is running on the same port as NEXT_PUBLIC_API_URL (default http://localhost:5000 — URL is normalized to append /api).';
    }
    return `Request failed (HTTP ${response.status})`;
  }

  const d = data as Record<string, unknown>;
  if (typeof d.error === 'string' && d.error.length) return d.error;
  if (typeof d.message === 'string' && d.message.length) return d.message;

  const nested = d.message;
  if (nested && typeof nested === 'object') {
    const m = nested as Record<string, unknown>;
    if (typeof m.error === 'string' && m.error.length) return m.error;
  }

  const arr = d.errors;
  if (Array.isArray(arr) && arr.length > 0) {
    const first = arr[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') {
      const e = first as Record<string, unknown>;
      if (typeof e.msg === 'string') return e.msg;
      if (typeof e.message === 'string') return e.message;
    }
  }

  if (response.status === 404) {
    return 'API endpoint not found. Check that NEXT_PUBLIC_API_URL matches your backend (e.g. http://localhost:5000).';
  }

  return `Request failed (HTTP ${response.status})`;
}

async function readResponseBody(response: Response): Promise<{ data: unknown; rawText: string }> {
  const rawText = await response.text();
  if (!rawText.trim()) {
    return { data: {}, rawText };
  }
  try {
    return { data: JSON.parse(rawText) as unknown, rawText };
  } catch {
    return { data: null, rawText };
  }
}

function assertAuthPayload(data: unknown): asserts data is { token: string; user: Record<string, unknown> } {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid response from server.');
  }
  const d = data as Record<string, unknown>;
  if (typeof d.token !== 'string' || !d.token) {
    throw new Error('Invalid response: missing authentication token.');
  }
  if (!d.user || typeof d.user !== 'object') {
    throw new Error('Invalid response: missing user data.');
  }
}

// API request helper
async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const token = getToken();
  const url = `${API_BASE_URL}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else if (IS_DEV) {
    console.debug('[apiRequest] No token in localStorage for request', { endpoint });
  }

  let response: Response;

  try {
    response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch (err) {
    if (IS_DEV) {
      console.debug('[apiRequest] Network / fetch failure', { url, endpoint, err });
    }
    const msg =
      err instanceof Error ? err.message : String(err);
    if (
      err instanceof TypeError &&
      (msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('fetch'))
    ) {
      throw new Error(
        'Cannot reach the API. Is the backend running? Check NEXT_PUBLIC_API_URL (e.g. http://localhost:5000).'
      );
    }
    throw err instanceof Error ? err : new Error('Network request failed');
  }

  const { data, rawText } = await readResponseBody(response);

  if (!response.ok) {
    const errMsg = parseApiErrorBody(data, response, rawText);
    if (IS_DEV) {
      console.debug('[apiRequest] Error response', {
        endpoint,
        url,
        status: response.status,
        message: errMsg,
        hadAuthHeader: !!token,
      });
    }

    if (response.status === 401) {
      clearAuth();
      throw new Error(
        errMsg.includes('token') || errMsg.includes('Access token')
          ? errMsg
          : 'Session expired or not signed in. Please log in again.'
      );
    }

    if (
      response.status === 403 &&
      errMsg.toLowerCase().includes('pending')
    ) {
      clearAuth();
      throw new Error('Your account is pending approval');
    }

    if (response.status === 403) {
      throw new Error(
        errMsg.toLowerCase().includes('permission') || errMsg.toLowerCase().includes('access denied')
          ? `${errMsg} If you are logged in as the correct role, try logging out and back in.`
          : errMsg
      );
    }

    throw new Error(errMsg);
  }

  return data;
}

// Multipart form data request helper (for file uploads)
async function apiRequestFormData(endpoint: string, formData: FormData, method = 'POST') {
  const token = getToken();
  const url = `${API_BASE_URL}${endpoint}`;

  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else if (IS_DEV) {
    console.debug('[apiRequestFormData] No token in localStorage', { endpoint });
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers,
      body: formData,
      credentials: 'include',
    });
  } catch (err) {
    if (IS_DEV) {
      console.debug('[apiRequestFormData] Network failure', { url, err });
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof TypeError && (msg === 'Failed to fetch' || msg.includes('fetch'))) {
      throw new Error(
        'Cannot reach the API. Is the backend running? Check NEXT_PUBLIC_API_URL.'
      );
    }
    throw err instanceof Error ? err : new Error('Network request failed');
  }

  const { data, rawText } = await readResponseBody(response);

  if (!response.ok) {
    const errMsg = parseApiErrorBody(data, response, rawText);
    if (IS_DEV) {
      console.debug('[apiRequestFormData] Error', {
        endpoint,
        url,
        status: response.status,
        message: errMsg,
        hadAuthHeader: !!token,
      });
    }

    if (response.status === 401) {
      clearAuth();
      throw new Error(
        errMsg.includes('token') || errMsg.includes('Access token')
          ? errMsg
          : 'Session expired or not signed in. Please log in again.'
      );
    }

    if (
      response.status === 403 &&
      errMsg.toLowerCase().includes('pending')
    ) {
      clearAuth();
      throw new Error('Your account is pending approval');
    }

    if (response.status === 403) {
      throw new Error(
        errMsg.toLowerCase().includes('permission') || errMsg.toLowerCase().includes('access denied')
          ? `${errMsg} If you are logged in as the correct role, try logging out and back in.`
          : errMsg
      );
    }

    throw new Error(errMsg);
  }

  return data;
}

// Auth API
export const authAPI = {
  login: async (email: string, password: string) => {
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    assertAuthPayload(data);
    return data;
  },

  signup: async (data: Record<string, unknown>) => {
    const res = await apiRequest('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    assertAuthPayload(res);
    return res;
  },

  // Deprecated: Use login() instead
  loginStudent: (email: string, password: string) =>
    apiRequest('/auth/login/student', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  loginTeacher: (email: string, password: string) =>
    apiRequest('/auth/login/teacher', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  loginAdmin: (email: string, password: string) =>
    apiRequest('/auth/login/admin', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  signupStudent: async (data: {
    email: string;
    password: string;
    fullName: string;
    schoolId: string;
    disabilityType: string;
  }) => {
    const res = await apiRequest('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ ...data, role: 'student' }),
    });
    assertAuthPayload(res);
    return res;
  },

  signupTeacher: async (data: {
    email: string;
    password: string;
    fullName: string;
    department: string;
    bio?: string;
  }) => {
    const res = await apiRequest('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ ...data, role: 'teacher' }),
    });
    assertAuthPayload(res);
    return res;
  },

  resetPassword: async (email: string, newPassword: string) => {
    return apiRequest('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, newPassword }),
    });
  },

  requestPasswordReset: async (email: string) => {
    return apiRequest('/auth/request-password-reset', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  confirmPasswordReset: async (email: string, code: string, newPassword: string) => {
    return apiRequest('/auth/confirm-password-reset', {
      method: 'POST',
      body: JSON.stringify({ email, code, newPassword }),
    });
  },
};

// Users API
export const usersAPI = {
  getAll: (params?: { role?: string; search?: string; page?: number; limit?: number }) => {
    return apiRequest(`/users${buildQuery(params as Record<string, string | number | boolean | undefined | null>)}`);
  },

  getById: (id: number) => apiRequest(`/users/${id}`),

  create: (data: any) =>
    apiRequest('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: number, data: any) =>
    apiRequest(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: number) =>
    apiRequest(`/users/${id}`, {
      method: 'DELETE',
    }),
};

// Courses API
export const coursesAPI = {
  getAll: (params?: {
    category?: string;
    difficulty?: string;
    teacherId?: number;
    status?: string;
    page?: number;
    limit?: number;
  }) => {
    return apiRequest(`/courses${buildQuery(params as Record<string, string | number | boolean | undefined | null>)}`);
  },

  getById: (id: number) => apiRequest(`/courses/${id}`),

  create: (data: any) =>
    apiRequest('/courses', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: number, data: any) =>
    apiRequest(`/courses/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: number) =>
    apiRequest(`/courses/${id}`, {
      method: 'DELETE',
    }),

  getTeacherCourses: () => {
    const user = getStoredUser();
    if (!user || user.role !== 'teacher') return Promise.resolve([]);
    return coursesAPI.getAll({ teacherId: user.id });
  },
};

// Lessons API
export const lessonsAPI = {
  getByCourse: (courseId: number) => apiRequest(`/lessons/course/${courseId}`),

  getById: (id: number) => apiRequest(`/lessons/${id}`),

  create: (data: {
    courseId: number;
    title: string;
    description?: string;
    content?: string;
    videoFile?: File | null;
    subtitleFile?: File | null;
    documentFile?: File | null;
    orderIndex: number;
    durationMinutes?: number;
  }) => {
    const formData = new FormData();
    formData.append('courseId', String(data.courseId));
    formData.append('title', data.title);
    formData.append('orderIndex', String(data.orderIndex));
    if (data.description) formData.append('description', data.description);
    if (data.content) formData.append('content', data.content);
    if (data.durationMinutes !== undefined) formData.append('durationMinutes', String(data.durationMinutes));
    if (data.videoFile) formData.append('video', data.videoFile);
    if (data.subtitleFile) formData.append('subtitle', data.subtitleFile);
    if (data.documentFile) formData.append('document', data.documentFile);
    return apiRequestFormData('/lessons', formData, 'POST');
  },

  update: (id: number, data: {
    title?: string;
    description?: string;
    content?: string;
    videoFile?: File | null;
    subtitleFile?: File | null;
    documentFile?: File | null;
    orderIndex?: number;
    durationMinutes?: number;
  }) => {
    const formData = new FormData();
    if (data.title !== undefined) formData.append('title', data.title);
    if (data.description !== undefined) formData.append('description', data.description);
    if (data.content !== undefined) formData.append('content', data.content);
    if (data.orderIndex !== undefined) formData.append('orderIndex', String(data.orderIndex));
    if (data.durationMinutes !== undefined) formData.append('durationMinutes', String(data.durationMinutes));
    if (data.videoFile) formData.append('video', data.videoFile);
    if (data.subtitleFile) formData.append('subtitle', data.subtitleFile);
    if (data.documentFile) formData.append('document', data.documentFile);
    return apiRequestFormData(`/lessons/${id}`, formData, 'PUT');
  },

  delete: (id: number) =>
    apiRequest(`/lessons/${id}`, {
      method: 'DELETE',
    }),
};

// Enrollments API
export const enrollmentsAPI = {
  getByStudent: (studentId: number) =>
    apiRequest(`/enrollments/student/${studentId}`),

  getByCourse: (courseId: number) =>
    apiRequest(`/enrollments/course/${courseId}`),

  enroll: (courseId: number) =>
    apiRequest('/enrollments', {
      method: 'POST',
      body: JSON.stringify({ courseId }),
    }),

  unenroll: (courseId: number) =>
    apiRequest(`/enrollments/${courseId}`, {
      method: 'DELETE',
    }),
};

// Progress API
export const progressAPI = {
  getByCourse: (courseId: number) => apiRequest(`/progress/course/${courseId}`),

  getByStudent: (studentId: number) =>
    apiRequest(`/progress/student/${studentId}`),

  completeLesson: (lessonId: number, timeSpent?: number) =>
    apiRequest(`/progress/lesson/${lessonId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ timeSpent }),
    }),

  updateTime: (lessonId: number, timeSpent: number) =>
    apiRequest(`/progress/lesson/${lessonId}/time`, {
      method: 'POST',
      body: JSON.stringify({ timeSpent }),
    }),
};

// Quizzes API
export const quizzesAPI = {
  getAvailable: () => apiRequest('/quizzes/available'),

  getByCourse: (courseId: number) => apiRequest(`/quizzes/course/${courseId}`),

  getById: (id: number) => apiRequest(`/quizzes/${id}`),

  create: (data: any) =>
    apiRequest('/quizzes', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: number, data: any) =>
    apiRequest(`/quizzes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: number) =>
    apiRequest(`/quizzes/${id}`, {
      method: 'DELETE',
    }),

  addQuestion: (quizId: number, data: any) =>
    apiRequest(`/quizzes/${quizId}/questions`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateQuestion: (questionId: number, data: any) =>
    apiRequest(`/quizzes/questions/${questionId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteQuestion: (questionId: number) =>
    apiRequest(`/quizzes/questions/${questionId}`, {
      method: 'DELETE',
    }),

  submitAttempt: (id: number, answers: any) =>
    apiRequest(`/quizzes/${id}/attempt`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    }),

  getAttempts: (id: number) => apiRequest(`/quizzes/${id}/attempts`),

  getRecentAttempts: () => apiRequest('/quizzes/student/attempts'),
};

// Feedback API
export const feedbackAPI = {
  getAll: (params?: { status?: string; category?: string; priority?: string }) => {
    return apiRequest(`/feedback${buildQuery(params as Record<string, string | number | boolean | undefined | null>)}`);
  },

  getTeacherAccessibility: () => apiRequest('/feedback/teacher/accessibility'),

  getByUser: (userId: number) => apiRequest(`/feedback/user/${userId}`),

  getById: (id: number) => apiRequest(`/feedback/${id}`),

  create: (data: any) =>
    apiRequest('/feedback', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateStatus: (id: number, status: string, adminResponse?: string) =>
    apiRequest(`/feedback/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, adminResponse }),
    }),

  delete: (id: number) =>
    apiRequest(`/feedback/${id}`, {
      method: 'DELETE',
    }),
};

// Audit API
export const auditAPI = {
  getAll: (params?: {
    userId?: number;
    action?: string;
    entityType?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    page?: number;
  }) => {
    return apiRequest(`/audit${buildQuery(params as Record<string, string | number | boolean | undefined | null>)}`);
  },

  getById: (id: number) => apiRequest(`/audit/${id}`),

  getStats: (params?: { startDate?: string; endDate?: string }) => {
    return apiRequest(`/audit/stats/summary${buildQuery(params as Record<string, string | number | boolean | undefined | null>)}`);
  },
};

// System API
export const systemAPI = {
  getStats: () => apiRequest('/system/stats'),
  getTeacherStats: () => apiRequest('/system/teacher/stats'),
  getStudentStats: () => apiRequest('/system/student/stats'),
};

// Accessibility microservice API
export const accessibilityAPI = {
  /** Submit an STT (video → subtitles) or TTS (document → audio) job */
  submitJob: (lessonId: number, jobType: 'stt' | 'tts') =>
    apiRequest('/accessibility/jobs', {
      method: 'POST',
      body: JSON.stringify({ lessonId, jobType }),
    }),

  /** Get all AI jobs for a specific lesson */
  getLessonJobs: (lessonId: number) => apiRequest(`/accessibility/lessons/${lessonId}/jobs`),
};
