import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from './ui/button';

export class ErrorBoundary extends Component<any, any> {
  state: any = {
    hasError: false,
    error: null,
  };

  constructor(props: any) {
    super(props);
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || "";
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center border border-slate-100">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">문제가 발생했습니다</h1>
            <p className="text-slate-600 mb-8">
              {errorMessage.startsWith('{') 
                ? "데이터베이스 연결에 문제가 발생했습니다. 잠시 후 다시 시도해주세요."
                : "예기치 않은 오류가 발생했습니다."}
            </p>
            <Button 
              onClick={() => window.location.reload()}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white py-6 rounded-xl text-lg font-medium transition-all"
            >
              새로고침
            </Button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}
