package providers

import (
	"fmt"
	"io"
	"log/slog"
	"sync"
)

// Registry manages available LLM providers.
type Registry struct {
	providers map[string]Provider
	mu        sync.RWMutex
}

func NewRegistry() *Registry {
	return &Registry{
		providers: make(map[string]Provider),
	}
}

// Register adds a provider to the registry.
// If a provider with the same name already exists, it is closed before replacement.
func (r *Registry) Register(provider Provider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if old, ok := r.providers[provider.Name()]; ok {
		if c, ok := old.(io.Closer); ok {
			c.Close()
		}
	}
	r.providers[provider.Name()] = provider
}

// Unregister removes a provider from the registry, closing it if it implements io.Closer.
func (r *Registry) Unregister(name string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if old, ok := r.providers[name]; ok {
		if c, ok := old.(io.Closer); ok {
			c.Close()
		}
		delete(r.providers, name)
	}
}

// Get returns a provider by name.
func (r *Registry) Get(name string) (Provider, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.providers[name]
	if !ok {
		return nil, fmt.Errorf("provider not found: %s", name)
	}
	return p, nil
}

// Close calls Close() on all providers that implement io.Closer.
func (r *Registry) Close() {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for name, p := range r.providers {
		if c, ok := p.(io.Closer); ok {
			if err := c.Close(); err != nil {
				slog.Warn("provider close error", "name", name, "error", err)
			}
		}
	}
}

// List returns all registered provider names.
func (r *Registry) List() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.providers))
	for name := range r.providers {
		names = append(names, name)
	}
	return names
}
