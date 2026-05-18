'use client';

import { useState, useEffect, useCallback } from 'react';
import React from 'react';
import { useRouter } from 'next/navigation';
import { RouteGuard } from '@/lib/route-guard';
import { DashboardLayout } from '@/components/dashboard-layout-new';
import { VideoPlayer } from '@/components/video-player';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { KeyboardShortcutsHelp } from '@/components/keyboard-shortcuts-help';
import { getServerOrigin, coursesAPI, progressAPI } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { EnrollCourseDialog } from '@/components/dialogs/enroll-course-dialog';
import {
  Volume2,
  Download,
  ChevronRight,
  CheckCircle,
  Circle,
  Loader2,
  AlertCircle,
  BookOpen,
  ArrowLeft,
  Headphones,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

// Helper to construct full video URL from backend path
const getVideoUrl = (videoPath: string | null | undefined): string | undefined => {
  if (!videoPath) return undefined;
  if (videoPath.startsWith('http://') || videoPath.startsWith('https://')) {
    return videoPath;
  }
  const baseUrl = getServerOrigin();
  return `${baseUrl}${videoPath}`;
};

// Helper to construct full subtitle URL from backend path
const getSubtitleUrl = (subtitlePath: string | null | undefined): string | undefined => {
  if (!subtitlePath) return undefined;
  if (subtitlePath.startsWith('http://') || subtitlePath.startsWith('https://')) {
    return subtitlePath;
  }
  const baseUrl = getServerOrigin();
  return `${baseUrl}${subtitlePath}`;
};

export default function CourseDetailPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = React.use(paramsPromise);
  const router = useRouter();
  const [course, setCourse] = useState<any>(null);
  const [lessons, setLessons] = useState<any[]>([]);
  const [currentLesson, setCurrentLesson] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { user } = useAuth();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [markedCompleted, setMarkedCompleted] = useState<number[]>([]);

  const fetchCourseData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const courseId = parseInt(params.id);
      const courseData = await coursesAPI.getById(courseId);

      setCourse(courseData);
      setLessons(courseData.lessons || []);

      // Debug logging for subtitle data
      console.log('=== COURSE DATA DEBUG ===');
      console.log('Course data:', courseData);
      console.log('Lessons with subtitle info:', courseData.lessons?.map((lesson: any) => ({
        id: lesson.id,
        title: lesson.title,
        video_url: lesson.video_url,
        subtitle_url: lesson.subtitle_url
      })));

      if (courseData.lessons && courseData.lessons.length > 0) {
        setCurrentLesson(courseData.lessons[0]);
        console.log('First lesson set as current:', courseData.lessons[0]);
      }

      if (courseData.is_enrolled) {
        const progressData = await progressAPI.getByCourse(courseId);
        const completedIds = progressData.lessons
          .filter((l: any) => l.completed)
          .map((l: any) => l.lesson_id);
        setMarkedCompleted(completedIds);
      }
    } catch (err: any) {
      console.error('Failed to fetch course detail:', err);
      setError(err.message || 'Failed to load course details. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchCourseData();
  }, [fetchCourseData]);

  const handleCompleteLesson = async (lessonId: number) => {
    try {
      await progressAPI.completeLesson(lessonId);
      setMarkedCompleted(prev => [...prev, lessonId]);
    } catch (err: any) {
      console.error('Failed to mark lesson as complete:', err);
    }
  };

  const speakText = (text: string) => {
    if ('speechSynthesis' in window) {
      if (isSpeaking) {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => setIsSpeaking(false);
      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
    } else {
      alert('Text-to-speech is not supported in your browser.');
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey) {
        switch (e.key.toLowerCase()) {
          case 'h':
            e.preventDefault();
            router.push('/student/dashboard');
            break;
          case 'c':
            e.preventDefault();
            router.push('/student/courses');
            break;
          case 'p':
            e.preventDefault();
            router.push('/student/progress');
            break;
          case 'q':
            e.preventDefault();
            router.push(`/student/quiz?courseId=${params.id}`);
            break;
        }
      }

      // Number shortcuts for lesson navigation (1-9)
      if (!e.ctrlKey && !e.altKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        const lessonIndex = parseInt(e.key) - 1;
        if (lessonIndex < lessons.length) {
          e.preventDefault();
          setCurrentLesson(lessons[lessonIndex]);
        }
      }

      // N for next lesson
      if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const currentIndex = lessons.findIndex(l => l.id === currentLesson?.id);
        if (currentIndex !== -1 && currentIndex < lessons.length - 1) {
          setCurrentLesson(lessons[currentIndex + 1]);
        }
      }

      // R to read lesson aloud
      if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (currentLesson) speakText(`${currentLesson.title}. ${currentLesson.description}`);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router, lessons, currentLesson]);

  const keyboardShortcuts = [
    { keys: ['Ctrl', 'H'], description: 'Go to Dashboard' },
    { keys: ['Ctrl', 'C'], description: 'Go to Courses' },
    { keys: ['Ctrl', 'P'], description: 'Go to Progress' },
    { keys: ['Ctrl', 'Q'], description: 'Go to Quiz' },
    { keys: ['1-9'], description: 'Jump to lesson' },
    { keys: ['N'], description: 'Next lesson' },
    { keys: ['R'], description: 'Read lesson aloud' },
  ];

  return (
    <RouteGuard allowedRoles={['student']}>
      <DashboardLayout role="student" userName={user?.full_name || "Student"} userRole="Student">
        <KeyboardShortcutsHelp shortcuts={keyboardShortcuts} />
        <div className="space-y-8">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
            </div>
          ) : (
            <>
              {/* Back Button */}
              <div className="flex items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => router.push('/student/courses')}
                  className="text-gray-600 hover:text-gray-900 -ml-2"
                  aria-label="Back to courses"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </div>

              {/* Course Header */}
              <div className="space-y-2">
                <Badge className="bg-blue-100 text-blue-700 border-0">
                  {course?.is_enrolled ? 'In Progress' : 'Not Enrolled'}
                </Badge>
                <h1 className="text-4xl font-bold text-gray-900 tracking-tight">{course?.title}</h1>
                <p className="text-lg text-gray-500">Instructor: {course?.teacher_name}</p>
              </div>

              {!course?.is_enrolled ? (
                <div className="py-12 text-center bg-gray-50 rounded-xl border border-dashed border-gray-300">
                  <BookOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600 font-medium">You are not enrolled in this course.</p>
                  <div className="mt-4 flex flex-col sm:flex-row gap-3 justify-center items-center">
                    <EnrollCourseDialog
                      courseId={String(course?.id)}
                      courseTitle={course?.title || ''}
                      onSuccess={fetchCourseData}
                    />
                    <Button
                      variant="outline"
                      onClick={() => router.push('/student/courses')}
                    >
                      Go Back to Courses
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Main Content */}
                  <div className="lg:col-span-2 space-y-6">
                    {/* Video Player */}
                    {currentLesson?.video_url && (
                      <VideoPlayer 
                        key={currentLesson.id} 
                        title={currentLesson.title} 
                        src={getVideoUrl(currentLesson.video_url)} 
                        subtitleSrc={getSubtitleUrl(currentLesson.subtitle_url)}
                      />
                    )}

                    {/* Audio Player — shown when TTS audio has been generated */}
                    {currentLesson?.audio_url && (
                      <Card className="border-0 shadow-sm">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Headphones className="h-4 w-4 text-purple-600" aria-hidden="true" />
                            Audio Version (AI-generated)
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <audio
                            controls
                            className="w-full"
                            aria-label={`Audio version of ${currentLesson.title}`}
                            src={getSubtitleUrl(currentLesson.audio_url)}
                          >
                            Your browser does not support the audio element.
                          </audio>
                          <p className="text-xs text-gray-500 mt-2">
                            AI-generated spoken version of the lesson document for visually impaired students.
                          </p>
                        </CardContent>
                      </Card>
                    )}

                    {/* Lesson Description */}
                    <Card className="border-0 shadow-sm">
                      <CardHeader className="pb-4">
                        <CardTitle className="text-2xl">{currentLesson?.title}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                          {currentLesson?.description}
                        </div>

                        <div className="flex flex-wrap gap-3 mt-6">
                          <Button
                            className="gap-2"
                            variant="outline"
                            onClick={() => speakText(`${currentLesson?.title}. ${currentLesson?.description}`)}
                          >
                            <Volume2 className="h-5 w-5" aria-hidden="true" />
                            {isSpeaking ? 'Stop Reading' : 'Read Lesson (TTS)'}
                          </Button>

                          {!markedCompleted.includes(currentLesson?.id) && (
                            <Button
                              className="gap-2 bg-green-600 hover:bg-green-700"
                              onClick={() => handleCompleteLesson(currentLesson.id)}
                            >
                              <CheckCircle className="h-5 w-5" aria-hidden="true" />
                              Mark as Complete
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Sidebar */}
                  <div className="space-y-6">
                    {/* Lessons List */}
                    <Card className="border-0 shadow-sm">
                      <CardHeader className="pb-4">
                        <CardTitle>Course Content</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2" role="list">
                          {lessons.map((lesson) => {
                            const isCompleted = markedCompleted.includes(lesson.id);
                            const isActive = currentLesson?.id === lesson.id;
                            return (
                              <li key={lesson.id}>
                                <button
                                  onClick={() => setCurrentLesson(lesson)}
                                  className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 text-left ${isActive ? 'bg-blue-50 border border-blue-100' : 'hover:bg-gray-50'
                                    }`}
                                  aria-label={`${lesson.title}${isCompleted ? ', completed' : ''}`}
                                >
                                  {isCompleted ? (
                                    <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" aria-hidden="true" />
                                  ) : (
                                    <Circle className="h-5 w-5 text-gray-300 flex-shrink-0" aria-hidden="true" />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <p className={`font-medium text-sm truncate ${isActive ? 'text-blue-700' : 'text-gray-900'}`}>
                                      {lesson.title}
                                    </p>
                                    <p className="text-xs text-gray-500">{lesson.duration || 'Flexible'}</p>
                                  </div>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </CardContent>
                    </Card>

                    {/* Download Materials */}
                    {currentLesson?.content_url && (
                      <Card className="border-0 shadow-sm">
                        <CardHeader className="pb-4">
                          <CardTitle>Lesson Materials</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ul className="space-y-2" role="list">
                            <li>
                              <a
                                href={currentLesson.content_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 text-left transition-colors"
                              >
                                <Download className="h-5 w-5 text-blue-600 flex-shrink-0" aria-hidden="true" />
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-sm text-gray-900 truncate">Course Material</p>
                                  <p className="text-xs text-gray-500">View/Download PDF</p>
                                </div>
                              </a>
                            </li>
                          </ul>
                        </CardContent>
                      </Card>
                    )}

                    {/* Next Lesson / Finish Course Button */}
                    {(() => {
                      const currentIndex = lessons.findIndex(l => l.id === currentLesson?.id);
                      const isLastLesson = currentIndex === lessons.length - 1;
                      const allCompleted = lessons.length > 0 && lessons.every(l => markedCompleted.includes(l.id));

                      if (currentIndex !== -1 && !isLastLesson) {
                        return (
                          <Button
                            className="w-full gap-2"
                            size="lg"
                            onClick={() => setCurrentLesson(lessons[currentIndex + 1])}
                          >
                            Next Lesson
                            <ChevronRight className="h-5 w-5" aria-hidden="true" />
                          </Button>
                        );
                      }

                      if (isLastLesson) {
                        return (
                          <div className="space-y-2">
                            <Button
                              className={`w-full gap-2 transition-all ${allCompleted
                                ? 'bg-green-600 hover:bg-green-700 text-white'
                                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                }`}
                              size="lg"
                              disabled={!allCompleted}
                              onClick={() => allCompleted && router.push('/student/progress')}
                              aria-label={allCompleted ? 'Finish Course' : 'Complete all lessons to finish'}
                            >
                              <CheckCircle className="h-5 w-5" aria-hidden="true" />
                              Finish Course
                            </Button>
                            {!allCompleted && (
                              <p className="text-xs text-center text-gray-500">
                                Complete all lessons to finish the course ({markedCompleted.length}/{lessons.length} done)
                              </p>
                            )}
                          </div>
                        );
                      }

                      return null;
                    })()}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DashboardLayout>
    </RouteGuard>
  );
}
