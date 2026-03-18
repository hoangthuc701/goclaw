package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/nextlevelbuilder/goclaw/internal/providers"
)

const (
	sunoPollInterval    = 3 * time.Second
	sunoPollMaxAttempts = 60 // 3s × 60 = 180s max
)

// sunoClip is a single clip in the Suno-compatible API response.
type sunoClip struct {
	ID       string `json:"id"`
	Status   string `json:"status"`
	AudioURL string `json:"audio_url"`
	Title    string `json:"title"`
}

// callSunoMusicGen generates music via a Suno-compatible API (e.g. gcui-art/suno-api).
// Suno must be registered as an LLM provider with provider_type "suno".
//
// Flow: POST /api/[custom_]generate → poll /api/get?ids={id} → download audio.
// Auth: Bearer token via apiKey (pass empty string for unauthenticated self-hosted instances).
func callSunoMusicGen(ctx context.Context, apiKey, apiBase, model, prompt string, params map[string]any) ([]byte, *providers.Usage, error) {
	lyrics := GetParamString(params, "lyrics", "")
	instrumental := GetParamBool(params, "instrumental", false)
	title := GetParamString(params, "title", "")
	style := GetParamString(params, "style", "")
	base := strings.TrimRight(apiBase, "/")

	clips, err := sunoSubmit(ctx, base, apiKey, model, prompt, lyrics, title, style, instrumental)
	if err != nil {
		return nil, nil, fmt.Errorf("suno submit: %w", err)
	}
	if len(clips) == 0 {
		return nil, nil, fmt.Errorf("suno: no clips in response")
	}

	// Poll the first clip (Suno generates 2 clips per request; use the first).
	audioURL, err := sunoPoll(ctx, base, apiKey, clips[0].ID)
	if err != nil {
		return nil, nil, fmt.Errorf("suno poll: %w", err)
	}

	audioBytes, err := sunoDownload(ctx, audioURL)
	if err != nil {
		return nil, nil, fmt.Errorf("suno download: %w", err)
	}

	return audioBytes, nil, nil
}

// sunoSubmit posts a generation request and returns the initial clip list.
// Uses /api/custom_generate when lyrics are provided, otherwise /api/generate.
func sunoSubmit(ctx context.Context, base, apiKey, model, prompt, lyrics, title, style string, instrumental bool) ([]sunoClip, error) {
	var endpoint string
	var body map[string]any

	if lyrics != "" {
		// Custom mode: explicit lyrics control style and duration.
		endpoint = base + "/api/custom_generate"
		body = map[string]any{
			"prompt":            lyrics,
			"tags":              style,
			"title":             title,
			"make_instrumental": instrumental,
		}
	} else {
		// Description mode: prompt describes the music style.
		endpoint = base + "/api/generate"
		body = map[string]any{
			"prompt":            prompt,
			"make_instrumental": instrumental,
		}
	}
	if model != "" {
		body["model"] = model
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, truncateBytes(respBody, 500))
	}

	var clips []sunoClip
	if err := json.Unmarshal(respBody, &clips); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}

	return clips, nil
}

// sunoPoll polls /api/get?ids={id} until the clip reaches a terminal status.
// Returns the audio_url on success, or an error on failure/timeout.
func sunoPoll(ctx context.Context, base, apiKey, clipID string) (string, error) {
	pollURL := base + "/api/get?ids=" + clipID
	client := &http.Client{Timeout: 15 * time.Second}

	for attempt := 0; attempt < sunoPollMaxAttempts; attempt++ {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(sunoPollInterval):
			}
		}

		req, err := http.NewRequestWithContext(ctx, "GET", pollURL, nil)
		if err != nil {
			return "", fmt.Errorf("create poll request: %w", err)
		}
		if apiKey != "" {
			req.Header.Set("Authorization", "Bearer "+apiKey)
		}

		resp, err := client.Do(req)
		if err != nil {
			// Transient network error — keep polling.
			continue
		}
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			continue
		}

		var clips []sunoClip
		if err := json.Unmarshal(respBody, &clips); err != nil || len(clips) == 0 {
			continue
		}

		clip := clips[0]
		switch clip.Status {
		case "complete", "completed", "SUCCESS":
			if clip.AudioURL == "" {
				return "", fmt.Errorf("clip complete but audio_url is empty")
			}
			return clip.AudioURL, nil
		case "error":
			return "", fmt.Errorf("suno clip generation failed")
		}
		// submitted / queued / streaming: keep polling.
	}

	return "", fmt.Errorf("suno generation timed out after %s",
		time.Duration(sunoPollMaxAttempts)*sunoPollInterval)
}

// sunoDownload fetches the generated audio bytes from the CDN URL.
func sunoDownload(ctx context.Context, audioURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", audioURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create download request: %w", err)
	}

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("download audio: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("download error %d: %s", resp.StatusCode, truncateBytes(body, 300))
	}

	audioBytes, err := limitedReadAll(resp.Body, maxMediaDownloadBytes)
	if err != nil {
		return nil, fmt.Errorf("read audio data: %w", err)
	}
	if len(audioBytes) == 0 {
		return nil, fmt.Errorf("empty audio response from Suno CDN")
	}

	return audioBytes, nil
}
