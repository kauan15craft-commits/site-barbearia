const authHashType = new URLSearchParams(window.location.hash.slice(1)).get("type");

if (authHashType === "invite" || authHashType === "recovery") {
    window.location.replace(`admin.html${window.location.hash}`);
}

const anoAtual = document.querySelector("#ano-atual");

if (anoAtual) {
    anoAtual.textContent = new Date().getFullYear();
}

const formAgendamento = document.querySelector("#form-agendamento");

if (formAgendamento) {
    const dataInput = document.querySelector("#data");
    const horarioSelect = document.querySelector("#horario");
    const statusAgendamento = document.querySelector("#status-agendamento");
    const submitButton = formAgendamento.querySelector("button[type='submit']");
    const config = window.BARBEARIA_SUPABASE;
    const supabase = config?.url && config?.anonKey && window.supabase
        ? window.supabase.createClient(config.url, config.anonKey)
        : null;
    const horarios = [];

    for (let hora = 9; hora <= 18; hora += 1) {
        horarios.push(`${String(hora).padStart(2, "0")}:00`);
        if (hora < 18) {
            horarios.push(`${String(hora).padStart(2, "0")}:30`);
        }
    }
    horarios.push("18:30");

    const hoje = new Date();
    const hojeLocal = new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60 * 1000)
        .toISOString()
        .split("T")[0];
    dataInput.min = hojeLocal;
    dataInput.value = hojeLocal;

    const mostrarStatus = (mensagem, tipo = "") => {
        statusAgendamento.textContent = mensagem;
        statusAgendamento.dataset.tipo = tipo;
    };

    const carregarHorarios = async () => {
        horarioSelect.replaceChildren();
        submitButton.disabled = true;

        const opcaoInicial = document.createElement("option");
        opcaoInicial.value = "";
        opcaoInicial.textContent = "Carregando horários...";
        horarioSelect.append(opcaoInicial);
        horarioSelect.disabled = true;

        if (!supabase) {
            opcaoInicial.textContent = "Agendamento indisponível";
            mostrarStatus("O sistema de agendamento ainda não foi configurado.", "erro");
            return;
        }

        const diaSelecionado = new Date(`${dataInput.value}T12:00:00`).getDay();
        if (diaSelecionado === 0) {
            opcaoInicial.textContent = "Fechado aos domingos";
            mostrarStatus("A barbearia não abre aos domingos.", "erro");
            return;
        }

        const { data: ocupados, error } = await supabase.rpc("get_unavailable_slots", {
            p_date: dataInput.value
        });

        if (error) {
            opcaoInicial.textContent = "Não foi possível carregar";
            mostrarStatus("Não foi possível carregar os horários. Tente novamente mais tarde.", "erro");
            console.error("Erro ao consultar horários:", error);
            return;
        }

        const horariosOcupados = new Set(ocupados.map(({ appointment_time }) => appointment_time));
        const limite = diaSelecionado === 6 ? "16:30" : "18:30";
        const disponiveis = horarios.filter((horario) =>
            horario <= limite && !horariosOcupados.has(horario)
        );

        if (dataInput.value === hojeLocal) {
            const agora = new Date();
            const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
            const primeiroHorarioFuturo = Math.ceil(minutosAgora / 30) * 30;
            const futuros = disponiveis.filter((horario) => {
                const [hora, minuto] = horario.split(":").map(Number);
                return hora * 60 + minuto >= primeiroHorarioFuturo;
            });
            disponiveis.splice(0, disponiveis.length, ...futuros);
        }

        if (disponiveis.length === 0) {
            opcaoInicial.textContent = "Sem horários disponíveis";
            horarioSelect.disabled = true;
            mostrarStatus("Não há horários disponíveis para essa data.", "erro");
            return;
        }

        horarioSelect.replaceChildren();
        disponiveis.forEach((horario) => {
            const option = document.createElement("option");
            option.value = horario;
            option.textContent = horario;
            horarioSelect.append(option);
        });
        horarioSelect.disabled = false;
        submitButton.disabled = false;
        mostrarStatus("");
    };

    dataInput.addEventListener("change", carregarHorarios);
    carregarHorarios();

    formAgendamento.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (!supabase) {
            mostrarStatus("O sistema de agendamento ainda não foi configurado.", "erro");
            return;
        }

        submitButton.disabled = true;
        mostrarStatus("Enviando seu pedido...");

        const { error } = await supabase.rpc("create_appointment", {
            p_customer_name: document.querySelector("#nome-cliente").value.trim(),
            p_customer_phone: document.querySelector("#telefone-cliente").value.trim(),
            p_service: document.querySelector("#servico").value,
            p_date: dataInput.value,
            p_time: horarioSelect.value
        });

        submitButton.disabled = false;

        if (error) {
            if (error.code === "23505" || error.message.includes("SLOT_UNAVAILABLE")) {
                mostrarStatus("Esse horário acabou de ser reservado. Escolha outro, por favor.", "erro");
                await carregarHorarios();
                return;
            }

            mostrarStatus("Não foi possível enviar o pedido. Confira os dados e tente novamente.", "erro");
            console.error("Erro ao solicitar agendamento:", error);
            return;
        }

        formAgendamento.reset();
        dataInput.value = hojeLocal;
        mostrarStatus("Pedido enviado! O horário ficará pendente até a confirmação do barbeiro.", "sucesso");
        await carregarHorarios();
    });
}
