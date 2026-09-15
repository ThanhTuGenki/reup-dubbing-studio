import { describe, expect, it } from 'vitest';
import { readRuntimeConfig, RuntimeConfigError } from './runtime-config';

describe('runtime config', () => {
  it('defaults to the loopback Control Plane in development', () => {
    expect(readRuntimeConfig({ MODE: 'development' }).controlPlaneUrl).toBe('http://localhost:3000/v1');
  });
  it.each(['https://api.example.com/v1', 'http://127.0.0.1:3000/v1'])('accepts a safe development URL: %s', (url) => {
    expect(readRuntimeConfig({ MODE: 'development', VITE_CONTROL_PLANE_URL: url }).controlPlaneUrl).toBe(url);
  });
  it('requires HTTPS in production', () => {
    expect(() => readRuntimeConfig({ PROD: true, VITE_CONTROL_PLANE_URL: 'http://localhost:3000/v1' })).toThrow(RuntimeConfigError);
    expect(readRuntimeConfig({ PROD: true, VITE_CONTROL_PLANE_URL: 'https://api.example.com/v1' }).controlPlaneUrl).toBe('https://api.example.com/v1');
  });
  it.each(['not-a-url', 'https://user:secret@example.com/v1', 'https://api.example.com/v1?token=value', 'https://api.example.com/v2'])('rejects invalid or unsafe URL: %s', (url) => {
    expect(() => readRuntimeConfig({ MODE: 'development', VITE_CONTROL_PLANE_URL: url })).toThrow(RuntimeConfigError);
  });
});
