package main

import (
	"errors"
	"net/http"

	"wgadmin/agent/internal/desired"
	"wgadmin/agent/internal/workerhttp"
)

// Handler — HTTP воркера wg: служебные пути агента и маршруты манифеста.
func (s *Service) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		workerhttp.JSON(w, http.StatusOK, s.Health())
	})
	mux.HandleFunc("GET /manifest", func(w http.ResponseWriter, _ *http.Request) {
		workerhttp.JSON(w, http.StatusOK, Manifest(s.version))
	})
	mux.HandleFunc("GET /metrics", func(w http.ResponseWriter, _ *http.Request) {
		workerhttp.JSON(w, http.StatusOK, s.Metrics())
	})

	mux.HandleFunc("PUT /config/state", func(w http.ResponseWriter, r *http.Request) {
		var state desired.State
		if _, err := workerhttp.ReadConfig(r, &state); err != nil {
			workerhttp.Error(w, http.StatusBadRequest, err.Error())

			return
		}
		if err := Validate(state); err != nil {
			workerhttp.Error(w, http.StatusUnprocessableEntity, err.Error())

			return
		}

		result, done := s.PutState(state)
		if !done {
			workerhttp.JSON(w, http.StatusAccepted, result)

			return
		}
		workerhttp.JSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("DELETE /config/state", func(w http.ResponseWriter, _ *http.Request) {
		s.DeleteState()
		workerhttp.NoContent(w)
	})

	mux.HandleFunc("PUT /config/probes", func(w http.ResponseWriter, r *http.Request) {
		var probes desired.Probes
		if _, err := workerhttp.ReadConfig(r, &probes); err != nil {
			workerhttp.Error(w, http.StatusBadRequest, err.Error())

			return
		}
		s.SetProbes(probes.Targets)
		workerhttp.JSON(w, http.StatusOK, map[string]int{"count": len(probes.Targets)})
	})
	mux.HandleFunc("DELETE /config/probes", func(w http.ResponseWriter, _ *http.Request) {
		s.SetProbes(nil)
		workerhttp.NoContent(w)
	})

	mux.HandleFunc("POST /interfaces/{name}/restart", func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")

		switch err := s.Restart(name); {
		case errors.Is(err, ErrNoInterface):
			workerhttp.Error(w, http.StatusNotFound, name+": "+err.Error())
		case errors.Is(err, ErrDisabled):
			workerhttp.Error(w, http.StatusConflict, name+": "+err.Error())
		case err != nil:
			workerhttp.Error(w, http.StatusInternalServerError, name+": "+err.Error())
		default:
			workerhttp.JSON(w, http.StatusOK, map[string]string{"name": name, "status": "up"})
		}
	})
	mux.HandleFunc("GET /state", func(w http.ResponseWriter, _ *http.Request) {
		if result := s.LastResult(); result != nil {
			workerhttp.JSON(w, http.StatusOK, result)

			return
		}
		workerhttp.Error(w, http.StatusNotFound, "конфигурация ещё не применялась")
	})

	mux.HandleFunc("POST /cleanup", func(w http.ResponseWriter, _ *http.Request) {
		s.Cleanup()
		workerhttp.NoContent(w)
	})

	mux.HandleFunc("/", workerhttp.NotFound)

	return mux
}
